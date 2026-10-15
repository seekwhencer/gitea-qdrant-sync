# MCP TypeScript SDK — Notes

Reference notes for the **MCP TypeScript SDK (v2)**, focused on building a server and
serving it over **Express**. Written to be directly usable when implementing an MCP
server. Sources:

- `docs/get-started/first-server.md` (GitHub, `modelcontextprotocol/typescript-sdk`)
- `@modelcontextprotocol/express` API reference (ts.sdk.modelcontextprotocol.io/v2),
  including every module listed under its **Modules** section.

---

## Part 1 — Build your first server (stdio)

An MCP **server** is a program that exposes *tools* a model can call. The tutorial
builds one tool — a US weather-alert lookup — and calls it from a client.

### Set up the project

Requires **Node.js 20+** and nothing else.

```bash
mkdir weather && cd weather
npm init -y
npm pkg set type=module
npm install @modelcontextprotocol/server zod tsx
mkdir src
```

- `type=module` matters — the SDK ships **ES modules only**.
- `tsx` runs TypeScript directly, so there is **no build step**.

### Register a tool

Create `src/index.ts`: a `createServer` factory that builds an `McpServer` and
registers one **tool** — a function the connected model can call.

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const NWS_API = 'https://api.weather.gov';

interface AlertsResponse {
  features: { properties: { event?: string; headline?: string } }[];
}

function createServer(): McpServer {
  const server = new McpServer({ name: 'weather', version: '1.0.0' });

  server.registerTool(
    'get-alerts',
    {
      description: 'Get the active weather alerts for a US state',
      inputSchema: z.object({
        state: z.string().length(2).describe('Two-letter US state code, e.g. CA')
      })
    },
    async ({ state }) => {
      const code = state.toUpperCase();
      const url = `${NWS_API}/alerts/active?area=${code}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'mcp-weather-tutorial/1.0' }
      });
      if (!res.ok) {
        return {
          content: [{ type: 'text', text: `NWS API error: HTTP ${res.status}` }],
          isError: true
        };
      }
      const { features } = (await res.json()) as AlertsResponse;
      if (features.length === 0) {
        return { content: [{ type: 'text', text: `No active alerts for ${code}.` }] };
      }
      const lines = features.map(
        f => f.properties.headline ?? f.properties.event ?? 'Unnamed alert'
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  return server;
}
```

Key points:

- `registerTool` takes a **name**, a **config**, and an **async handler**.
- `inputSchema` is a **Zod schema — the only schema you write**. From that one schema
  the SDK derives the JSON Schema the model sees, **validates arguments before your
  handler runs**, and infers the handler's argument types.
- The handler returns `content`, a list of typed blocks — one `text` block here.
  `isError: true` marks a failed result the model can read and react to.

> **Tip:** Call `get-alerts` with `{ "state": "California" }` and the SDK rejects it
> *before* your handler runs. The result the model sees is:
> `Input validation error: Invalid arguments for tool get-alerts: state: Too big: expected string to have <=2 characters`

### Serve it over stdio

At the end of the file, hand the factory to `serveStdio`.

```ts
void serveStdio(createServer);
console.error('weather MCP server running on stdio');
```

- `serveStdio` owns the **stdio transport**: it reads requests on stdin, writes
  responses to stdout, and calls `createServer` to build the instance that serves the
  connection.
- **stdout is the protocol channel.** Log with `console.error` — one `console.log`
  corrupts the JSON-RPC stream.

### Run it

Start the server from the project root:

```bash
npx tsx src/index.ts
```

The banner lands on stderr, leaving stdout for the protocol:

```
weather MCP server running on stdio
```

Nothing else happens: an stdio server waits on stdin for a client to start the
conversation. Stop it with `Ctrl+C`.

### Call the tool

The **MCP Inspector** is a local web app for calling a server's tools directly — it
launches the command you give it and connects over stdio.

```bash
npx @modelcontextprotocol/inspector npx tsx src/index.ts
```

In the browser tab it opens, click **Connect**, open the **Tools** tab, select
`get-alerts`, enter a two-letter state code such as `TX`, and run it. The text block in
the result lists each active alert headline for that state — the same content a model
receives when it calls your tool.

### Pick a transport

Your server speaks stdio because a host launches it as a local process and owns its
lifetime. To host one endpoint that many clients connect to, serve the same
`createServer` factory over **HTTP** instead.

Next on this path, *Plug into a real host* registers this server in VS Code, Claude
Code, and Cursor; *Tools* goes deeper on what a tool can return.

### Recap

- `registerTool(name, config, handler)` registers a tool; `inputSchema` is the one Zod
  schema you write.
- The SDK validates every call against that schema and rejects bad arguments before
  your handler runs.
- `serveStdio(createServer)` builds the server from your factory and serves it on
  stdin/stdout.
- stdout carries the protocol; log to stderr.
- `npx @modelcontextprotocol/inspector <command>` exercises any stdio server without a
  host.

---

## Part 2 — `@modelcontextprotocol/express` package

**Express adapters for the MCP TypeScript server SDK.**

This package is a **thin Express integration layer** for `@modelcontextprotocol/server`.
It does **not** implement MCP itself. Instead, it helps you:

- create an Express app with sensible defaults for MCP servers
- add **DNS rebinding protection** via Host header validation (recommended for
  localhost servers)
- protect routes with `requireBearerAuth` (validates `Authorization: Bearer …` via your
  `OAuthTokenVerifier`)
- serve **OAuth Protected Resource Metadata (RFC 9728)** via `mcpAuthMetadataRouter`

### Install

```bash
npm install @modelcontextprotocol/server @modelcontextprotocol/express express

# For MCP Streamable HTTP over Node.js (IncomingMessage/ServerResponse):
npm install @modelcontextprotocol/node
```

### Exports

- `createMcpExpressApp(options?)`
- `hostHeaderValidation(allowedHostnames)`
- `localhostHostValidation()`
- `requireBearerAuth(options)`
- `mcpAuthMetadataRouter(options)`
- `getOAuthProtectedResourceMetadataUrl(serverUrl)`
- `OAuthTokenVerifier` (interface)

### Usage

**Create an Express app** (localhost DNS rebinding protection by default):

```ts
import { createMcpExpressApp } from '@modelcontextprotocol/express';

const app = createMcpExpressApp(); // default host is 127.0.0.1; protection enabled
```

**Streamable HTTP endpoint (Express):**

```ts
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { McpServer } from '@modelcontextprotocol/server';

const app = createMcpExpressApp();

app.post('/mcp', async (req, res) => {
  // Stateless example: create a server and a transport per request (with sessions: one pair per session).
  const server = new McpServer({ name: 'my-server', version: '1.0.0' });
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
```

**Host header validation (DNS rebinding protection):**

```ts
import { hostHeaderValidation } from '@modelcontextprotocol/express';

app.use(hostHeaderValidation(['localhost', '127.0.0.1', '[::1]']));
```

### Modules

The package is split into modules. Each is documented below.

---

#### Module: `auth/bearerAuth`

**Type alias**

- `BearerAuthMiddlewareOptions` = `VerifyBearerTokenOptions`
  - Defined in: `middleware/express/src/auth/bearerAuth.ts:8`
  - Options for `requireBearerAuth`.

**Function**

- `requireBearerAuth(options): RequestHandler`
  - Defined in: `middleware/express/src/auth/bearerAuth.ts:26`
  - Express middleware that requires a valid Bearer token in the `Authorization` header.
  - The Express adapter over the runtime-neutral core in `@modelcontextprotocol/server`
    (`verifyBearerToken` / `bearerAuthChallengeResponse` — or `requireBearerAuth` from
    that package for web-standard `fetch(request)` hosts). The token is validated via the
    supplied `OAuthTokenVerifier` and the resulting `AuthInfo` is attached to `req.auth`.
    The MCP Streamable HTTP transport reads `req.auth` and surfaces it to handlers as
    `ctx.http.authInfo`.
  - On failure the middleware sends a JSON OAuth error body and a
    `WWW-Authenticate: Bearer …` challenge that includes the configured
    `resource_metadata` URL so clients can discover the Authorization Server.
  - **Parameters:** `options: VerifyBearerTokenOptions`
  - **Returns:** `RequestHandler`

---

#### Module: `auth/metadataRouter`

**Interface**

- `AuthMetadataOptions`
  - Defined in: `server/src/server/middleware/oauthMetadata.ts:8`
  - Options for `oauthMetadataResponse` and `buildOAuthProtectedResourceMetadata`.
  - **Properties:**
    - `dangerouslyAllowInsecureIssuerUrl?: boolean`
      - Defined in: `oauthMetadata.ts:44`
      - Allow a non-HTTPS issuer URL. **Local testing only — never enable in
        production.** The Express adapter maps its
        `MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL` environment variable here.
    - `oauthMetadata: object`
      - Defined in: `oauthMetadata.ts:14`
      - Authorization Server metadata (RFC 8414) for the AS this MCP server relies on.
        Served at `/.well-known/oauth-authorization-server` so legacy clients that probe
        the resource origin still discover the AS.
      - Index signature: `[key: string]: unknown`
      - Fields:
        - `authorization_endpoint: string` (SafeUrlSchema)
        - `authorization_response_iss_parameter_supported?: boolean`
        - `client_id_metadata_document_supported?: boolean`
        - `code_challenge_methods_supported?: string[]`
        - `dpop_signing_alg_values_supported?: string[]`
          - RFC 9449 §5.1 (DPoP, SEP-1932): the JWS alg values this authorization server
            accepts for DPoP proofs at the token endpoint. A server supporting DPoP MUST
            publish this field.
        - `grant_types_supported?: string[]`
        - `introspection_endpoint?: string`
        - `introspection_endpoint_auth_methods_supported?: string[]`
        - `introspection_endpoint_auth_signing_alg_values_supported?: string[]`
        - `issuer: string`
        - `registration_endpoint?: string`
        - `response_modes_supported?: string[]`
        - `response_types_supported: string[]`
        - `revocation_endpoint?: string`
        - `revocation_endpoint_auth_methods_supported?: string[]`
        - `revocation_endpoint_auth_signing_alg_values_supported?: string[]`
        - `scopes_supported?: string[]`
        - `service_documentation?: string`
        - `token_endpoint: string` (SafeUrlSchema)
        - `token_endpoint_auth_methods_supported?: string[]`
        - `token_endpoint_auth_signing_alg_values_supported?: string[]`
    - `resourceName?: string`
      - Defined in: `oauthMetadata.ts:37`
      - Optional human-readable name advertised as `resource_name`.
    - `resourceServerUrl: URL`
      - Defined in: `oauthMetadata.ts:21`
      - The public URL of this MCP server, used as the `resource` value in the Protected
        Resource Metadata document. Any path component is reflected in the well-known
        route per RFC 9728.
    - `scopesSupported?: string[]`
      - Defined in: `oauthMetadata.ts:32`
      - Optional list of scopes this MCP server understands, advertised as
        `scopes_supported`.
    - `serviceDocumentationUrl?: URL`
      - Defined in: `oauthMetadata.ts:26`
      - Optional documentation URL advertised as `resource_documentation`.

**Functions**

- `allowedMethods(allowed): RequestHandler`
  - Defined in: `middleware/express/src/auth/metadataRouter.ts:24`
  - Express middleware that rejects HTTP methods not in the supplied allow-list with a
    `405 Method Not Allowed` and an OAuth-style error body. Used by `metadataHandler` to
    restrict metadata endpoints to GET/OPTIONS.
  - **Parameters:** `allowed: string[]`
  - **Returns:** `RequestHandler`

- `getOAuthProtectedResourceMetadataUrl(serverUrl): string`
  - Defined in: `server/src/server/middleware/oauthMetadata.ts:91`
  - Builds the RFC 9728 Protected Resource Metadata URL for a given MCP server URL by
    inserting `/.well-known/oauth-protected-resource` ahead of the path.
  - **Parameters:** `serverUrl: URL`
  - **Returns:** `string`
  - Example:
    ```ts
    getOAuthProtectedResourceMetadataUrl(new URL('https://api.example.com/mcp'))
    // → 'https://api.example.com/.well-known/oauth-protected-resource/mcp'
    ```

- `mcpAuthMetadataRouter(options): Router`
  - Defined in: `middleware/express/src/auth/metadataRouter.ts:80`
  - Builds an Express router that serves the two OAuth discovery documents an MCP server
    acting purely as a Resource Server needs to expose:
    - `/.well-known/oauth-protected-resource[/<path>]` — RFC 9728 Protected Resource
      Metadata, derived from the supplied options.
    - `/.well-known/oauth-authorization-server` — RFC 8414 Authorization Server Metadata,
      passed through verbatim from the supplied `oauthMetadata`.
  - Mount this router at the application root:
    ```ts
    app.use(mcpAuthMetadataRouter({ oauthMetadata, resourceServerUrl }));
    ```
  - Pair with `requireBearerAuth` on your `/mcp` route and pass
    `getOAuthProtectedResourceMetadataUrl` as its `resourceMetadataUrl` so unauthenticated
    clients can discover the AS from the 401 challenge.
  - **Parameters:** `options: AuthMetadataOptions`
  - **Returns:** `Router`

- `metadataHandler(metadata): RequestHandler`
  - Defined in: `middleware/express/src/auth/metadataRouter.ts:42`
  - Builds a small Express router that serves the given OAuth metadata document at `/` as
    JSON, with permissive CORS and a GET/OPTIONS method allow-list.
  - Used by `mcpAuthMetadataRouter` for both the Authorization Server and Protected
    Resource metadata endpoints.
  - **Parameters:** `metadata` — a union of the RFC 8414 Authorization Server metadata
    object and the RFC 9728 Protected Resource metadata object (fields as listed above,
    plus `resource`, `resource_documentation`, `resource_name`, `resource_policy_uri`,
    `resource_signing_alg_values_supported`, `resource_tos_uri`,
    `tls_client_certificate_bound_access_tokens`, `authorization_details_types_supported`,
    `authorization_servers`, `bearer_methods_supported`,
    `dpop_bound_access_tokens_required`, `jwks_uri`).
  - **Returns:** `RequestHandler`

---

#### Module: `auth/types`

**Interface**

- `OAuthTokenVerifier`
  - Defined in: `server/src/server/middleware/bearerAuth.ts:13`
  - Minimal token-verifier interface for MCP servers acting as an OAuth 2.0 Resource
    Server. Implementations introspect or locally validate an access token and return the
    resulting `AuthInfo`, which the serving entry surfaces to MCP request handlers via
    `ctx.http.authInfo`.
  - This is intentionally narrower than a full OAuth Authorization Server provider — it
    only covers the verification step a Resource Server needs.
  - **Method:**
    - `verifyAccessToken(token): Promise<AuthInfo>`
      - Defined in: `bearerAuth.ts:27`
      - Verifies an access token and returns information about it.
      - Implementations should throw an `OAuthError` with
        `OAuthErrorCode.InvalidToken` when the token is unknown, revoked, or otherwise
        invalid; the bearer-auth helpers map that to a 401 with a `WWW-Authenticate`
        challenge.
      - **Note:** bearer-auth verification rejects tokens whose `AuthInfo.expiresAt` is
        unset (matches v1 behavior). Ensure your verifier populates it (e.g. from RFC 7662
        introspection `exp` or the JWT `exp` claim).
      - **Parameters:** `token: string`
      - **Returns:** `Promise<AuthInfo>`

---

#### Module: `express`

**Interface**

- `CreateMcpExpressAppOptions`
  - Defined in: `middleware/express/src/express.ts:10`
  - Options for creating an MCP Express application.
  - **Properties:**
    - `allowedHosts?: string[]`
      - Defined in: `express.ts:25`
      - List of allowed hostnames for DNS rebinding protection. If provided, host header
        validation will be applied using this list. For IPv6, provide addresses with
        brackets (e.g., `[::1]`).
      - Useful when binding to `0.0.0.0` or `::` but still wanting to restrict which
        hostnames are allowed.
    - `allowedOrigins?: string[]`
      - Defined in: `express.ts:42`
      - List of allowed origin hostnames for Origin header validation. If provided, Origin
        validation will be applied using this list (port-agnostic, hostnames only — the
        same convention as `allowedHosts`).
      - When omitted, Origin validation is automatically enabled for localhost-class binds
        (the same condition as host validation): requests without an Origin header pass,
        while a present Origin whose hostname is not localhost-class is rejected with 403.
      - A client that runs as a browser extension sends its extension ID as the origin
        hostname: list that ID to admit one extension. A lowercase entry of the form
        `<scheme>://*` (e.g. `moz-extension://*`) admits every extension of that browser.
        `http://*` and `https://*` are not honoured.
    - `host?: string`
      - Defined in: `express.ts:15`
      - The hostname to bind to. Defaults to `127.0.0.1`. When set to `127.0.0.1`,
        `localhost`, or `::1`, DNS rebinding protection is automatically enabled.
    - `jsonLimit?: string`
      - Defined in: `express.ts:51`
      - Controls the maximum request body size for the JSON body parser. Passed directly
        to Express's `express.json({ limit })` option. Defaults to Express's built-in
        default of `100kb`.
      - Example: `'1mb'`, `'500kb'`, `'10mb'`

**Function**

- `createMcpExpressApp(options?): Express`
  - Defined in: `middleware/express/src/express.ts:80`
  - Creates an Express application pre-configured for MCP servers.
  - When the host is `127.0.0.1`, `localhost`, or `::1` (the default is `127.0.0.1`), DNS
    rebinding protection middleware is automatically applied to protect against DNS
    rebinding attacks on localhost servers.
  - **Parameters:** `options?: CreateMcpExpressAppOptions = {}` — configuration options
  - **Returns:** `Express` — a configured Express application
  - **Examples:**
    - Basic usage — defaults to `127.0.0.1` with DNS rebinding protection:
      ```ts
      const app = createMcpExpressApp();
      ```
    - Custom host — DNS rebinding protection only applied for localhost hosts:
      ```ts
      const appOpen = createMcpExpressApp({ host: '0.0.0.0' }); // No automatic DNS rebinding protection
      const appLocal = createMcpExpressApp({ host: 'localhost' }); // DNS rebinding protection enabled
      ```
    - Custom allowed hosts for non-localhost binding:
      ```ts
      const app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts: ['myapp.local', 'localhost'] });
      ```

---

#### Module: `express.examples`

Type-checked examples for `express.ts`. These examples are synced into JSDoc comments via
the `sync-snippets` script. Each function's region markers define the code snippet that
appears in the docs.

---

#### Module: `index`

Re-exports (the public surface of the package):

- `AuthMetadataOptions`
- `BearerAuthMiddlewareOptions`
- `createMcpExpressApp`
- `CreateMcpExpressAppOptions`
- `getOAuthProtectedResourceMetadataUrl`
- `hostHeaderValidation`
- `localhostHostValidation`
- `localhostOriginValidation`
- `mcpAuthMetadataRouter`
- `OAuthTokenVerifier`
- `originValidation`
- `requireBearerAuth`

---

#### Module: `middleware/hostHeaderValidation`

**Functions**

- `hostHeaderValidation(allowedHostnames): RequestHandler`
  - Defined in: `middleware/express/src/middleware/hostHeaderValidation.ts:23`
  - Express middleware for DNS rebinding protection. Validates the `Host` header hostname
    (port-agnostic) against an allowed list.
  - Particularly important for servers without authorization or HTTPS, such as localhost
    servers or development servers. DNS rebinding attacks can bypass same-origin policy by
    manipulating DNS to point a domain to a localhost address, allowing malicious websites
    to access your local server.
  - **Parameters:** `allowedHostnames: string[]` — list of allowed hostnames (without
    ports). For IPv6, provide the address with brackets (e.g., `[::1]`).
  - **Returns:** `RequestHandler` — Express middleware function
  - Example:
    ```ts
    const middleware = hostHeaderValidation(['localhost', '127.0.0.1', '[::1]']);
    app.use(middleware);
    ```

- `localhostHostValidation(): RequestHandler`
  - Defined in: `middleware/express/src/middleware/hostHeaderValidation.ts:50`
  - Convenience middleware for localhost DNS rebinding protection. Allows only `localhost`,
    `127.0.0.1`, and `[::1]` (IPv6 localhost) hostnames.
  - **Returns:** `RequestHandler`
  - Example:
    ```ts
    app.use(localhostHostValidation());
    ```

---

#### Module: `middleware/hostHeaderValidation.examples`

Type-checked examples for `hostHeaderValidation.ts`. These examples are synced into JSDoc
comments via the `sync-snippets` script. Each function's region markers define the code
snippet that appears in the docs.

---

#### Module: `middleware/originValidation`

**Functions**

- `localhostOriginValidation(): RequestHandler`
  - Defined in: `middleware/express/src/middleware/originValidation.ts:50`
  - Convenience middleware for localhost Origin validation. Allows only origins whose
    hostname is `localhost`, `127.0.0.1`, or `[::1]` (IPv6 localhost).
  - **Returns:** `RequestHandler`
  - Example:
    ```ts
    app.use(localhostOriginValidation());
    ```

- `originValidation(allowedOriginHostnames): RequestHandler`
  - Defined in: `middleware/express/src/middleware/originValidation.ts:23`
  - Express middleware for Origin header validation. Validates the `Origin` header hostname
    (port-agnostic) against an allowed list.
  - Browsers attach an `Origin` header to cross-origin requests; validating it — alongside
    Host header validation — protects localhost and development servers against DNS
    rebinding and cross-site request forgery. Requests without an `Origin` header pass
    (non-browser MCP clients do not send one); a present value that is not allowed, or that
    cannot be parsed, is rejected with 403.
  - **Parameters:** `allowedOriginHostnames: string[]` — list of allowed origin hostnames
    (without scheme or port), or `<scheme>://*` entries. For IPv6, provide the address with
    brackets (e.g., `[::1]`).
  - **Returns:** `RequestHandler` — Express middleware function
  - Example:
    ```ts
    app.use(originValidation(['localhost', '127.0.0.1', '[::1]']));
    ```
