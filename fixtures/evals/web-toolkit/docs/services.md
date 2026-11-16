# Services

Every web service and the port it listens on in local development.

| Service       | Port | Owner     |
|---------------|------|-----------|
| gateway       | 8080 | platform  |
| accounts      | 8101 | identity  |
| billing       | 8102 | payments  |
| notifications | 8110 | messaging |
| search        | 8120 | discovery |

The admin console runs inside `gateway` and has no port of its own.
