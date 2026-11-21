import Foundation
import Observation
import PicaProtocol

/// The engine's fan-outs (R-11), newest first, kept current from `fanout.changed` and reloaded on each connection.
@Observable @MainActor
public final class FanOutStore {
    public private(set) var fanOuts: [FanOut] = []
    public private(set) var failure: String?
    public private(set) var hasLoaded = false

    @ObservationIgnored private let backend: any FanOutBackend
    @ObservationIgnored private var following: Task<Void, Never>?
    /// Counts notifications, so a reload that started before one does not undo it.
    @ObservationIgnored private var changeCount = 0
    @ObservationIgnored private var changedAt: [Id: Int] = [:]

    public init(backend: any FanOutBackend) {
        self.backend = backend
    }

    /// Follows the engine until `stop()`. Calling it again does nothing.
    public func start() {
        guard following == nil else { return }
        let backend = backend
        following = Task {
            // Listen before the first load, so no change between the load and the listening is missed.
            let changes = await backend.changes()
            let connections = await backend.connections()
            await withDiscardingTaskGroup { group in
                group.addTask {
                    for await fanOut in changes { await self.changed(fanOut) }
                }
                group.addTask {
                    for await _ in connections { await self.reload() }
                }
            }
        }
    }

    public func stop() {
        following?.cancel()
        following = nil
    }

    public func cancel(_ fanOutId: Id) async {
        do {
            changed(try await backend.cancel(fanOutId))
        } catch {
            failure = Self.describe(error)
        }
    }

    func reload() async {
        let startedAt = changeCount
        do {
            let listed = try await backend.list()
            var merged = Dictionary(listed.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
            for (id, at) in changedAt where at > startedAt {
                merged[id] = fanOuts.first { $0.id == id } ?? merged[id]
            }
            set(Array(merged.values))
            failure = nil
            hasLoaded = true
        } catch {
            failure = Self.describe(error)
        }
    }

    func changed(_ fanOut: FanOut) {
        changeCount += 1
        changedAt[fanOut.id] = changeCount
        var next = fanOuts.filter { $0.id != fanOut.id }
        next.append(fanOut)
        set(next)
    }

    /// Assigns only when something differs, so an unchanged reload does not redraw the view.
    private func set(_ next: [FanOut]) {
        let sorted = next.sorted { left, right in
            left.createdAt != right.createdAt ? left.createdAt > right.createdAt : left.id < right.id
        }
        if sorted != fanOuts { fanOuts = sorted }
    }

    private static func describe(_ error: any Error) -> String {
        String(describing: error)
    }
}
