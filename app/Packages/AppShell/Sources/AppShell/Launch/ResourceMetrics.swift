import Darwin
import Foundation

/// The app's own CPU use and memory, for PLAN.md §9's idle CPU and memory budgets (H-07, docs/performance.md). Only
/// the UI tests turn it on, with `PICA_RESOURCE_METRICS_PATH`. Each time a file named `<path>.request` appears, holding
/// the window in seconds, it removes the file, measures the process's CPU time (user and system, every thread) over
/// that window, and writes one report to the path. It waits on a kqueue source for the folder, so waiting costs no
/// CPU. The engine is another process and is not counted.
@MainActor
public final class ResourceMetrics {
    public struct Report: Codable, Equatable, Sendable {
        public var cpuSeconds: Double
        public var wallSeconds: Double
        /// CPU time over wall time: 0.01 is 1% of one core.
        public var cpuFraction: Double
        /// The physical footprint at the end of the window, as Activity Monitor's Memory column shows it.
        public var footprintBytes: UInt64
        /// The largest footprint since the app started.
        public var peakFootprintBytes: UInt64
    }

    private let reportURL: URL
    private var requestURL: URL { reportURL.appendingPathExtension("request") }
    private var source: (any DispatchSourceFileSystemObject)?
    private var measuring: Task<Void, Never>?

    public convenience init?(environment: [String: String]) {
        guard let path = environment["PICA_RESOURCE_METRICS_PATH"], !path.isEmpty else { return nil }
        self.init(reportURL: URL(filePath: path))
    }

    init(reportURL: URL) {
        self.reportURL = reportURL
    }

    /// Starts watching for requests.
    public func start() {
        guard source == nil else { return }
        let folder = open(reportURL.deletingLastPathComponent().path, O_EVTONLY)
        guard folder >= 0 else { return }
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: folder, eventMask: .write, queue: .main)
        source.setEventHandler { [weak self] in
            MainActor.assumeIsolated { self?.folderChanged() }
        }
        source.setCancelHandler { close(folder) }
        self.source = source
        source.resume()
        folderChanged()
    }

    public func stop() {
        source?.cancel()
        source = nil
        measuring?.cancel()
    }

    private func folderChanged() {
        guard measuring == nil, let request = try? String(contentsOf: requestURL, encoding: .utf8) else { return }
        try? FileManager.default.removeItem(at: requestURL)
        let window = Duration.seconds(Double(request.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 10)
        measuring = Task { [weak self] in
            let report = await Self.measure(over: window)
            guard let self, !Task.isCancelled else { return }
            try? JSONEncoder().encode(report).write(to: reportURL, options: .atomic)
            measuring = nil
        }
    }

    static func measure(over window: Duration) async -> Report {
        let startCPU = cpuSeconds()
        let startWall = ContinuousClock.now
        try? await Task.sleep(for: window)
        let elapsed = ContinuousClock.now - startWall
        let wall = Double(elapsed.components.seconds) + Double(elapsed.components.attoseconds) / 1e18
        let cpu = cpuSeconds() - startCPU
        let memory = footprint()
        return Report(
            cpuSeconds: cpu, wallSeconds: wall, cpuFraction: wall > 0 ? cpu / wall : 0,
            footprintBytes: memory.current, peakFootprintBytes: memory.peak)
    }

    /// The process's CPU time so far, user and system.
    static func cpuSeconds() -> Double {
        var usage = rusage()
        getrusage(RUSAGE_SELF, &usage)
        let seconds = { (time: timeval) in Double(time.tv_sec) + Double(time.tv_usec) / 1_000_000 }
        return seconds(usage.ru_utime) + seconds(usage.ru_stime)
    }

    /// The process's physical footprint now and at its largest, in bytes.
    static func footprint() -> (current: UInt64, peak: UInt64) {
        var info = rusage_info_v4()
        let result = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(getpid(), RUSAGE_INFO_V4, $0) }
        }
        guard result == 0 else { return (0, 0) }
        return (info.ri_phys_footprint, info.ri_lifetime_max_phys_footprint)
    }
}
