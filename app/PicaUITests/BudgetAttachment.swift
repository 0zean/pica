import Foundation
import XCTest

/// One measured PLAN.md §9 budget, attached to the test's result as `budget-<id>.json` for the H-07 performance gate
/// (`make perf`, docs/performance.md), which exports the attachments from the result bundle. `id` is the row's id in
/// tools/perf/budgets.json. The test still asserts the threshold itself.
struct BudgetMeasurement: Encodable {
    var id: String
    var measured: Double
    var threshold: Double
    var unit: String
    var samples: [Double]?
}

extension XCTestCase {
    @MainActor
    func recordBudget(_ measurement: BudgetMeasurement) {
        guard let data = try? JSONEncoder().encode(measurement) else { return }
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "budget-\(measurement.id).json"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
