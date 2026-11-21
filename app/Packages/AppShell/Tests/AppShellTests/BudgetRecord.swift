import Foundation

/// One measured PLAN.md §9 budget, written for the H-07 performance gate (docs/performance.md) to
/// `$PICA_PERF_DIR/<id>.json` when `make perf` sets it. `id` is the row's id in tools/perf/budgets.json.
struct BudgetRecord: Encodable {
    var id: String
    var measured: Double
    var threshold: Double
    var unit: String
    var samples: [Double]?

    func write(environment: [String: String] = ProcessInfo.processInfo.environment) {
        guard let directory = environment["PICA_PERF_DIR"], !directory.isEmpty else { return }
        let folder = URL(filePath: directory)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? JSONEncoder().encode(self).write(to: folder.appending(path: "\(id).json"), options: .atomic)
    }
}

/// The median of `values`, the upper one for an even count.
func median(_ values: [Double]) -> Double {
    let sorted = values.sorted()
    return sorted.isEmpty ? .infinity : sorted[sorted.count / 2]
}
