import Darwin
import Foundation
import Synchronization

/// The `PATH` the engine runs with (`docs/app-shell.md#the-engines-path`).
///
/// An app opened from Finder or the Dock inherits launchd's `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), so tools the
/// engine spawns from Homebrew or `~/.local/bin` (`gh`, MCP stdio servers, hooks) are not found. At launch the app asks
/// the user's login shell for its `PATH` and puts it in front of its own; when the shell fails or is too slow, it adds
/// the usual install directories that exist instead.
enum LoginShellPath {
    /// launchd's default for GUI apps.
    static let launchdDefault = "/usr/bin:/bin:/usr/sbin:/sbin"
    /// Added when the login shell gives no answer, if they exist. `~` is the user's home.
    static let commonDirectories = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "~/.local/bin"]
    static let defaultTimeout: Duration = .seconds(3)
    /// Set for the shell Pica runs, so a slow rc file can skip work: `[[ -n $PICA_RESOLVING_PATH ]] && return`.
    static let resolvingVariable = "PICA_RESOLVING_PATH"

    /// `environment` with `PATH` replaced by the login shell's (or the fallback's) merged with its own.
    static func engineEnvironment(
        _ environment: [String: String], timeout: Duration = defaultTimeout, accountShell: String? = accountShell()
    ) async -> [String: String] {
        let shell = shellPath(environment: environment, accountShell: accountShell)
        let resolved = await query(shell: shell, environment: environment, timeout: timeout)
        var result = environment
        result["PATH"] = merged(
            resolved: resolved, current: environment["PATH"], home: environment["HOME"] ?? NSHomeDirectory(),
            exists: { FileManager.default.fileExists(atPath: $0) })
        return result
    }

    /// `SHELL` when it is absolute, else the account's shell, else zsh (as the terminal picks it, A-10).
    static func shellPath(environment: [String: String], accountShell: String?) -> String {
        [environment["SHELL"], accountShell].compactMap { $0 }.first { $0.hasPrefix("/") } ?? "/bin/zsh"
    }

    /// The resolved entries first, then the current ones it lacks. Without a resolved `PATH`, the common directories
    /// that exist and are missing go in front of the current `PATH`.
    static func merged(resolved: String?, current: String?, home: String, exists: (String) -> Bool) -> String {
        let currentEntries = entries(current ?? launchdDefault)
        let front: [String]
        if let resolved, !entries(resolved).isEmpty {
            front = entries(resolved)
        } else {
            front = commonDirectories
                .map { $0.hasPrefix("~/") ? home + $0.dropFirst() : $0 }
                .filter(exists)
        }
        var seen = Set<String>()
        return (front + currentEntries).filter { seen.insert($0).inserted }.joined(separator: ":")
    }

    static func entries(_ path: String) -> [String] {
        path.split(separator: ":").map(String.init).filter { !$0.isEmpty }
    }

    /// The text between the first two markers, trimmed; nil when they are missing or enclose nothing.
    /// Whatever the shell's rc files print around them (banners, warnings) is ignored.
    static func parse(_ output: String, marker: String) -> String? {
        let parts = output.components(separatedBy: marker)
        guard parts.count >= 3 else { return nil }
        let path = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
        return path.isEmpty ? nil : path
    }

    /// The arguments: a login, interactive shell (so `.zprofile` and `.zshrc`, or `.bash_profile`, are read)
    /// that prints the exported `PATH` between markers. The same text works in sh, bash, zsh and fish.
    static func arguments(marker: String) -> [String] {
        ["-l", "-i", "-c", "printf '%s' '\(marker)'; /usr/bin/printenv PATH; printf '%s' '\(marker)'"]
    }

    /// Runs the shell and returns the `PATH` it printed, or nil if it could not run, printed nothing usable, or
    /// did not answer within `timeout` (the shell is then killed).
    static func query(shell: String, environment: [String: String], timeout: Duration) async -> String? {
        let marker = "__PICA_PATH_\(UUID().uuidString)__"
        let process = Process()
        process.executableURL = URL(filePath: shell)
        process.arguments = arguments(marker: marker)
        var shellEnvironment = environment
        shellEnvironment[resolvingVariable] = "1"
        process.environment = shellEnvironment
        process.currentDirectoryURL = URL(filePath: environment["HOME"] ?? NSHomeDirectory())
        let stdout = Pipe()
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = stdout
        process.standardError = FileHandle.nullDevice

        let answer = OneShot<String?>()
        let output = Mutex(Data())
        // Reads until both markers have arrived: a background job the rc files start may keep the pipe open.
        stdout.fileHandleForReading.readabilityHandler = { handle in
            let chunk = handle.availableData
            let text: String? = output.withLock { data in
                data.append(chunk)
                return String(decoding: data, as: UTF8.self)
            }
            if chunk.isEmpty {
                handle.readabilityHandler = nil
                answer.resolve(text.flatMap { parse($0, marker: marker) })
            } else if let text, let path = parse(text, marker: marker) {
                handle.readabilityHandler = nil
                answer.resolve(path)
            }
        }
        process.terminationHandler = { _ in
            // Give the last bytes a moment to arrive, then answer with what was read.
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.2) {
                answer.resolve(output.withLock { parse(String(decoding: $0, as: UTF8.self), marker: marker) })
            }
        }
        do {
            try process.run()
        } catch {
            stdout.fileHandleForReading.readabilityHandler = nil
            return nil
        }
        try? stdout.fileHandleForWriting.close()
        let pid = process.processIdentifier
        let timer = Task {
            try? await Task.sleep(for: timeout)
            answer.resolve(nil)
        }
        let path = await answer.wait() ?? nil
        timer.cancel()
        stdout.fileHandleForReading.readabilityHandler = nil
        if process.isRunning {
            Darwin.kill(pid, SIGKILL)
        }
        return path
    }

    static func accountShell() -> String? {
        guard let entry = getpwuid(getuid()), let shell = entry.pointee.pw_shell else { return nil }
        return String(cString: shell)
    }
}
