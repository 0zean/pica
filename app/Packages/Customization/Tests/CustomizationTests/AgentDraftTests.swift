@testable import Customization
import Foundation
import PicaProtocol
import Testing

/// X-02: an agent created in the UI is written as a file the C-02 loader accepts. The New Agent sheet's text must equal
/// `fixtures/customization/ui-agent.md`, which `server/tests/customization/customization.test.ts` creates through
/// `customization.create` and loads with C-02's `MarkdownAgentLoader`.
struct AgentDraftTests {
    private static let fixture = URL(filePath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "fixtures/customization/ui-agent.md")

    @Test func theNewAgentSheetWritesTheFileTheEngineLoaderTestLoads() throws {
        var draft = NewItemDraft(kind: .agent, locationId: "user")
        draft.name = "changelog-checker"
        draft.description = "Checks changelog entries: one per merged \"pull request\""
        draft.tier = .worker
        draft.tools = " view,grep , glob,"
        draft.body = "You check that every merged pull request has a changelog entry.\n\nAnswer with the pull requests that have none.\n\n"

        #expect(draft.problem(singleFile: false) == nil)
        #expect(draft.text == (try String(contentsOf: Self.fixture, encoding: .utf8)))
    }

    @Test func aSkillNamesItsFolderAndAnInstructionsFileIsItsText() {
        var skill = NewItemDraft(kind: .skill, locationId: "user")
        skill.name = "release"
        skill.description = "Release steps"
        skill.body = "Run the script."
        #expect(skill.text == "---\nname: \"release\"\ndescription: \"Release steps\"\n---\n\nRun the script.\n")

        var instructions = NewItemDraft(kind: .instructions, locationId: "user")
        instructions.body = "Answer briefly."
        #expect(instructions.problem(singleFile: true) == nil)
        #expect(instructions.text == "Answer briefly.\n")
    }

    @Test func theSheetSaysWhatIsMissing() {
        var draft = NewItemDraft(kind: .agent)
        #expect(draft.problem(singleFile: false) == "Choose where to create it.")
        draft.locationId = "user"
        #expect(draft.problem(singleFile: false) == "Give it a name.")
        draft.name = "a"
        #expect(draft.problem(singleFile: false) == "Describe it in a sentence.")
        draft.description = "d"
        draft.tools = " , "
        #expect(draft.problem(singleFile: false) == "List the agent's tools.")
        draft.tools = "view"
        #expect(draft.problem(singleFile: false) == "Write the agent's prompt.")
    }
}
