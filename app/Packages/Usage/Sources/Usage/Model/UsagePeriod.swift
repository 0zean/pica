import Foundation
import PicaProtocol

/// The dashboard's period: whole UTC days ending with today, as the ledger's `day` rollup counts them (docs/usage.md).
public enum UsagePeriod: String, CaseIterable, Identifiable, Sendable {
    case today
    case last7Days
    case last30Days

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .today: "Today"
        case .last7Days: "Last 7 Days"
        case .last30Days: "Last 30 Days"
        }
    }

    var dayCount: Int {
        switch self {
        case .today: 1
        case .last7Days: 7
        case .last30Days: 30
        }
    }

    /// The first day's midnight, and the midnight after today, both UTC.
    public func range(now: Date) -> (from: Date, to: Date) {
        let today = UTCDay.start(of: now)
        return (UTCDay.adding(-(dayCount - 1), to: today), UTCDay.adding(1, to: today))
    }

    /// The `usage.rollup` bounds for the period.
    func bounds(now: Date) -> (from: Timestamp, to: Timestamp) {
        let range = range(now: now)
        return (UTCDay.timestamp(range.from), UTCDay.timestamp(range.to))
    }

    /// Each day of the period, oldest first, as `YYYY-MM-DD`.
    func dayKeys(now: Date) -> [String] {
        let from = range(now: now).from
        return (0..<dayCount).map { UTCDay.key(UTCDay.adding($0, to: from)) }
    }
}

/// Calendar days in UTC, the time zone the engine groups usage by.
enum UTCDay {
    static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        return calendar
    }()

    static func start(of date: Date) -> Date {
        calendar.startOfDay(for: date)
    }

    static func adding(_ days: Int, to date: Date) -> Date {
        calendar.date(byAdding: .day, value: days, to: date) ?? date
    }

    static func key(_ date: Date) -> String {
        date.formatted(Date.ISO8601FormatStyle(timeZone: .gmt).year().month().day())
    }

    static func timestamp(_ date: Date) -> Timestamp {
        date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true, timeZone: .gmt))
    }

    /// "Nov 16" for `2026-11-16`, independent of the Mac's time zone.
    static func label(_ key: String) -> String {
        guard let date = try? Date(key, strategy: Date.ISO8601FormatStyle(timeZone: .gmt).year().month().day()) else {
            return key
        }
        var style = Date.FormatStyle.dateTime.month(.abbreviated).day()
        style.timeZone = .gmt
        return date.formatted(style)
    }
}
