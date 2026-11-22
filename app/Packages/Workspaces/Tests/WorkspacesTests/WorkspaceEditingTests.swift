@testable import Workspaces
import Foundation
import PicaProtocol
import Testing

private func workspace(
    _ id: Id, _ name: String, pinned: [Id] = [], sources: [RepoSource] = []
) -> Workspace {
    Workspace(id: id, name: name, sources: sources, pinnedRepoIds: pinned, overrides: WorkspaceOverrides())
}

private func session(_ id: Id, _ state: SessionState) -> Session {
    Session(
        id: id, workspaceId: "w1", title: id, state: state, writeRoots: [], referenceRoots: [], routingProfile: .off,
        budgetCredits: nil, lastSeq: 0, createdAt: "2026-11-22T00:00:00Z", updatedAt: "2026-11-22T00:00:00Z")
}

private let platform = RepoSource(id: "s1", kind: .team, org: "acme", selector: "platform", lastSyncedAt: nil)
private let atlasClone = Repo(
    id: "r1", remoteUrl: "https://github.com/acme/atlas", localPath: "/managed/acme/atlas", managed: true,
    defaultBranch: "main", cloneState: .cloned)
private let available = Repo(
    id: "r2", remoteUrl: "https://github.com/acme/beacon", localPath: nil, managed: true, defaultBranch: "main",
    cloneState: .available)
private let ownFolder = Repo(
    id: "r3", remoteUrl: "https://github.com/acme/ledger", localPath: "/work/ledger", managed: false,
    defaultBranch: "main", cloneState: .cloned)

@Suite struct WorkspaceNamingTests {
    let all = [workspace("w1", "Platform"), workspace("w2", "Payments")]

    @Test func anEmptyNameIsRefused() {
        #expect(WorkspaceNaming.problem(for: "   ", renaming: "w1", among: all) == "Enter a name.")
    }

    @Test func anotherWorkspacesNameIsRefusedIgnoringCaseAndSpaces() {
        #expect(WorkspaceNaming.problem(for: " payments ", renaming: "w1", among: all)
            == "Another workspace is already named “Payments”.")
        #expect(WorkspaceNaming.problem(for: "Payments", renaming: nil, among: all) != nil)
    }

    @Test func aWorkspaceMayKeepOrRecaseItsOwnName() {
        #expect(WorkspaceNaming.problem(for: "platform", renaming: "w1", among: all) == nil)
        #expect(WorkspaceNaming.problem(for: "Infra", renaming: "w1", among: all) == nil)
    }
}

@MainActor
@Suite struct WorkspaceRenameTests {
    let backend = FakeWorkspacesBackend()

    private func manager() -> WorkspaceManager {
        let manager = WorkspaceManager(backend: backend, fixes: FixPerformer(openURL: { _ in }, copy: { _ in }))
        manager.workspaces = { [workspace("w1", "Platform"), workspace("w2", "Payments")] }
        return manager
    }

    @Test func renamingSendsTheTrimmedName() async {
        let manager = manager()
        manager.presentRename(workspaceId: "w1")
        #expect(manager.sheet == .renameWorkspace(workspaceId: "w1"))
        #expect(await manager.renameWorkspace("w1", to: "  Infra "))
        #expect(backend.calls == ["rename w1 Infra"])
    }

    @Test func anInvalidNameOrAnUnchangedOneIsNotSent() async {
        let manager = manager()
        #expect(await manager.renameWorkspace("w1", to: "Payments") == false)
        #expect(await manager.renameWorkspace("w1", to: "") == false)
        #expect(await manager.renameWorkspace("w1", to: "Platform"))
        #expect(backend.calls.isEmpty)
    }

    @Test func aFailedRenameKeepsTheSheetWithTheProblem() async {
        backend.failures["renameWorkspace"] = .noRemote
        let manager = manager()
        #expect(await manager.renameWorkspace("w1", to: "Infra") == false)
        #expect(manager.renameProblem?.code == .invalidParams)
    }

    @Test func renamingAnUnknownWorkspaceOpensNothing() {
        let manager = manager()
        manager.presentRename(workspaceId: "gone")
        #expect(manager.sheet == nil)
    }
}

@Suite struct WorkspaceDeletionTests {
    @Test func theConfirmationSaysWhatGoesAndWhatStays() {
        let deletion = WorkspaceDeletion(
            workspace: workspace("w1", "Platform"), repos: [atlasClone, available],
            sessions: [session("a", .ended), session("b", .idle), session("c", .resumable)])
        #expect(!deletion.isBlocked)
        #expect(deletion.title == "Delete “Platform”?")
        #expect(deletion.message == "Its 3 sessions are deleted with their transcripts and usage history. "
            + "The open session is ended first. Its sources and settings go too. Its 2 repos stay registered, and "
            + "nothing on disk is deleted: folders and clones stay where they are. This can’t be undone.")
    }

    @Test func aWorkspaceWithoutSessionsSaysSo() {
        let deletion = WorkspaceDeletion(workspace: workspace("w1", "Platform"), repos: [], sessions: [])
        #expect(deletion.message.hasPrefix("It has no sessions."))
    }

    @Test func aSessionAtWorkBlocksTheDeletion() {
        let deletion = WorkspaceDeletion(
            workspace: workspace("w1", "Platform"), repos: [],
            sessions: [session("a", .running), session("b", .awaitingApproval), session("c", .idle)])
        #expect(deletion.isBlocked)
        #expect(deletion.busyCount == 2)
        #expect(deletion.title == "“Platform” has sessions at work")
        #expect(deletion.message
            == "2 sessions are working or waiting for an approval. Stop them or let them finish, then delete the workspace.")
    }
}

@MainActor
@Suite struct WorkspaceDeleteFlowTests {
    let backend = FakeWorkspacesBackend()

    private func manager(sessions: [Session] = []) -> (WorkspaceManager, () -> [Id]) {
        let manager = WorkspaceManager(backend: backend, fixes: FixPerformer(openURL: { _ in }, copy: { _ in }))
        manager.workspaces = { [workspace("w1", "Platform")] }
        manager.sessions = { _ in sessions }
        var deleted: [Id] = []
        manager.onDeleted = { deleted.append($0) }
        return (manager, { deleted })
    }

    @Test func confirmingDeletesAndHandsTheIdOn() async {
        let (manager, deleted) = manager(sessions: [session("a", .ended)])
        _ = manager.store(for: "w1")
        manager.requestDelete(workspaceId: "w1")
        #expect(manager.pendingDeletion?.sessionCount == 1)
        #expect(await manager.confirmDelete())
        #expect(backend.calls == ["delete w1"])
        #expect(deleted() == ["w1"])
        #expect(manager.pendingDeletion == nil)
    }

    @Test func aBlockedDeletionIsNeverSent() async {
        let (manager, deleted) = manager(sessions: [session("a", .running)])
        manager.requestDelete(workspaceId: "w1")
        #expect(manager.pendingDeletion?.isBlocked == true)
        #expect(await manager.confirmDelete() == false)
        #expect(backend.calls.isEmpty)
        #expect(deleted().isEmpty)
    }

    @Test func theEnginesRefusalIsShown() async {
        backend.failures["deleteWorkspace"] = .sessionsBusy
        let (manager, deleted) = manager()
        manager.requestDelete(workspaceId: "w1")
        #expect(await manager.confirmDelete() == false)
        #expect(manager.deleteProblem?.code == .invalidState)
        #expect(deleted().isEmpty)
    }
}

@Suite struct RepoRemovalTests {
    @Test func aTeamRepoSaysSyncWontBringItBackAndThatNothingIsOnDisk() {
        let removal = RepoRemoval(repo: available, workspace: workspace("w1", "Platform", sources: [platform]))
        #expect(removal.title == "Remove “beacon” from “Platform”?")
        #expect(!removal.canDeleteClone)
        #expect(removal.message == "It came from team acme/platform; Sync won’t add it back. It was never cloned, so "
            + "nothing is on disk. Add it again by path or URL to bring it back.")
    }

    @Test func aFolderTheUserAddedStaysWhereItIs() {
        let removal = RepoRemoval(repo: ownFolder, workspace: workspace("w1", "Platform", pinned: ["r3"]))
        #expect(!removal.canDeleteClone)
        #expect(removal.message == "Its folder at /work/ledger stays where it is. Add it again by path or URL to bring it back.")
    }

    @Test func aManagedCloneCanBeDeletedAndSaysWhenPicaRefuses() {
        let removal = RepoRemoval(repo: atlasClone, workspace: workspace("w1", "Platform", pinned: ["r1"], sources: [platform]))
        #expect(removal.canDeleteClone)
        #expect(removal.message.hasPrefix("Sync won’t add it back from the workspace’s teams. Its clone at /managed/acme/atlas stays on disk"))
        #expect(removal.message.contains("uncommitted changes or unpushed commits"))
    }
}

@MainActor
@Suite struct RepoRemovalFlowTests {
    let backend = FakeWorkspacesBackend()

    @Test func removingLeavesFilesAlone() async {
        let store = WorkspaceStore(workspaceId: "w1", backend: backend)
        #expect(await store.removeRepo(RepoRemoval(repo: atlasClone, workspace: workspace("w1", "Platform")), deletingClone: false))
        #expect(backend.calls == ["removeRepo r1 w1"])
        #expect(store.repoProblem == nil)
    }

    @Test func deletingTheCloneForgetsTheRepoAfterRemovingIt() async {
        let store = WorkspaceStore(workspaceId: "w1", backend: backend)
        #expect(await store.removeRepo(RepoRemoval(repo: atlasClone, workspace: workspace("w1", "Platform")), deletingClone: true))
        #expect(backend.calls == ["removeRepo r1 w1", "forgetRepo r1"])
    }

    @Test func aFolderTheUserAddedIsNeverForgottenFromHere() async {
        let store = WorkspaceStore(workspaceId: "w1", backend: backend)
        #expect(await store.removeRepo(RepoRemoval(repo: ownFolder, workspace: workspace("w1", "Platform")), deletingClone: true))
        #expect(backend.calls == ["removeRepo r3 w1"])
    }

    @Test func aCloneWithLocalWorkIsKeptAndTheProblemSaysSo() async {
        backend.failures["forgetRepo"] = .hasLocalWork
        let store = WorkspaceStore(workspaceId: "w1", backend: backend)
        #expect(await store.removeRepo(RepoRemoval(repo: atlasClone, workspace: workspace("w1", "Platform")), deletingClone: true))
        #expect(store.repoProblem?.code == .refusedWithoutForce)
        #expect(store.repoProblem?.message.hasPrefix("Removed atlas from the workspace, but kept its clone: ") == true)
    }

    @Test func aFailedRemovalDoesNotTouchTheClone() async {
        backend.failures["removeRepo"] = .noRemote
        let store = WorkspaceStore(workspaceId: "w1", backend: backend)
        #expect(await store.removeRepo(RepoRemoval(repo: atlasClone, workspace: workspace("w1", "Platform")), deletingClone: true) == false)
        #expect(backend.calls == ["removeRepo r1 w1"])
        #expect(store.repoProblem?.code == .invalidParams)
    }
}
