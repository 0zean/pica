import Foundation
import PicaProtocol

/// Requests the engine sends to the app (`MethodDirection.engine`): `secrets.get` and `secrets.set`.
extension EngineClient {
    func answerEngineRequest(id: RequestId, method: String, line: Data) {
        switch method {
        case Methods.SecretsGet.name:
            answerSecretsGet(id: id, line: line)
        case Methods.SecretsSet.name:
            answerSecretsSet(id: id, line: line)
        default:
            reply(id, error: .methodNotFound, number: .methodNotFound, message: "The app does not handle \(method).")
        }
    }

    private func answerSecretsGet(id: RequestId, line: Data) {
        guard let params = try? decoder.decode(ParamsEnvelope<SecretsGetParams>.self, from: line).params else {
            reply(id, error: .invalidParams, number: .invalidParams, message: "secrets.get needs a secretRef.")
            return
        }
        let requestGeneration = generation
        Task {
            let outcome: Result<String, SecretBrokerError>
            do throws(SecretBrokerError) {
                outcome = .success(try await secrets.secret(for: params.secretRef))
            } catch {
                outcome = .failure(error)
            }
            guard generation == requestGeneration else { return }
            answerSecret(id, ref: params.secretRef, outcome: outcome)
        }
    }

    /// M-07: the engine moved an inline secret out of an imported MCP entry and hands it over to keep.
    private func answerSecretsSet(id: RequestId, line: Data) {
        guard let params = try? decoder.decode(ParamsEnvelope<SecretsSetParams>.self, from: line).params else {
            reply(id, error: .invalidParams, number: .invalidParams, message: "secrets.set needs a secretRef and a value.")
            return
        }
        let requestGeneration = generation
        Task {
            var failure: SecretBrokerError?
            do throws(SecretBrokerError) {
                try await secrets.store(params.value, for: params.secretRef)
            } catch {
                failure = error
            }
            guard generation == requestGeneration else { return }
            switch failure {
            case nil:
                write(OutgoingResult(id: id, result: Ok()))
            case .notFound:
                reply(
                    id, error: .secretUnresolved, number: .application,
                    message: "The Keychain could not store \(params.secretRef).", ref: params.secretRef)
            case .unavailable(_, let status):
                reply(
                    id, error: .secretUnresolved, number: .application,
                    message: "The Keychain could not store \(params.secretRef) (status \(status)).", ref: params.secretRef)
            }
        }
    }

    private func answerSecret(_ id: RequestId, ref: String, outcome: Result<String, SecretBrokerError>) {
        switch outcome {
        case .success(let value):
            write(OutgoingResult(id: id, result: SecretsGetResult(value: value)))
        case .failure(.notFound):
            reply(id, error: .secretUnresolved, number: .application, message: "No secret is stored for \(ref).", ref: ref)
        case .failure(.unavailable(_, let status)):
            reply(
                id, error: .secretUnresolved, number: .application,
                message: "The Keychain could not read \(ref) (status \(status)).", ref: ref)
        }
    }

    private func reply(_ id: RequestId, error code: ErrorCode, number: RpcErrorNumber, message: String, ref: String? = nil) {
        let details = ref.map { ["secretRef": JSONValue.string($0)] }
        let error = RpcError(code: number.rawValue, message: message, data: ErrorData(code: code, details: details))
        write(OutgoingError(id: id, error: error))
    }

    private func write(_ message: some Encodable) {
        guard let connection, let frame = try? encoder.frame(message) else { return }
        connection.send(frame)
    }
}
