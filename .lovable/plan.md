## Problem

The Assistant page throws "Assistant error. Please try again." and the network request to `assistant-chat` fails with "Failed to fetch". The outgoing request has a malformed header:

```text
content-type: application/json, application/json
```

The AI SDK's `DefaultChatTransport` already attaches `Content-Type: application/json` on its own. In `AssistantChat.tsx`, the custom `prepareSendMessagesRequest` also returns `'Content-Type': 'application/json'`. The two get merged into `application/json, application/json`, which the browser rejects, so the `fetch` never reaches the server. The edge function itself is healthy (a direct test call streams a correct response).

## Fix

In `src/components/AssistantChat.tsx`, inside `prepareSendMessagesRequest`, stop setting `Content-Type` manually. Only return the headers the transport does not already provide (`Authorization`, `apikey`). The transport supplies the JSON content type.

```text
return {
  headers: {
    Authorization: `Bearer ${token}`,
    apikey: ANON_KEY,
  },
  body: { messages, threadId: id, ownerId },
};
```

## Verification

- Reload `/assistant`, send a message, and confirm the assistant streams a reply with no toast error.
- Confirm the network request now sends a single `content-type: application/json`.
- Send a data question (e.g. "top business expenses this year") and confirm a tool-backed answer renders.