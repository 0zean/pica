import Darwin
import Foundation

/// Cold launch to interactive window (PLAN.md §9, budget 1.0 s), measured from the kernel's process start time.
public enum LaunchTiming {
    /// When this process was started, from `sysctl(KERN_PROC_PID)`.
    public static func processStart() -> Date? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var name: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&name, u_int(name.count), &info, &size, nil, 0) == 0 else { return nil }
        let start = info.kp_proc.p_un.__p_starttime
        return Date(timeIntervalSince1970: TimeInterval(start.tv_sec) + TimeInterval(start.tv_usec) / 1_000_000)
    }

    /// Writes `{"launchToInteractiveSeconds": …}` to `path`, for the launch performance test.
    public static func record(interactiveAt now: Date = Date(), to path: String) {
        guard let start = processStart() else { return }
        let seconds = now.timeIntervalSince(start)
        let json = #"{"launchToInteractiveSeconds":\#(seconds)}"#
        try? Data(json.utf8).write(to: URL(filePath: path), options: .atomic)
    }
}
