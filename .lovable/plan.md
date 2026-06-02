## Goal
Make the Assistant chat reliably stream answers instead of failing with "Assistant error / Failed to fetch".

## Root cause
The `assistant-chat` edge function streams its reply with `result.toUIMessageStreamResponse({ originalMessages, onFinish })` but does **not** attach CORS headers. The browser blocks the cross-origin streamed response (no `Access-Control-Allow-Origin`), producing `TypeError: Failed to fetch` on the client and `Http: connection closed before message completed` in the function logs. The preflight (`OPTIONS`) and the 500 error path already include `corsHeaders`; only the success/streaming path is missing them.

## Changes

### 1. `supabase/functions/assistant-chat/index.ts`
Add CORS headers to the streaming response:

```ts
return result.toUIMessageStreamResponse({
  headers: corsHeaders,
  originalMessages: messages,
  onFinish: async ({ responseMessage }) => { /* unchanged */ },
});
```

No other logic in the function changes. Then redeploy the function (automatic).

### 2. (Optional, minor) `src/components/AssistantChat.tsx` / `prompt-input.tsx`
The console shows a non-fatal warning: "Function components cannot be given refs" for `PromptInputTextarea`. This does not break the chat, but if desired I can wrap `PromptInputTextarea` in `React.forwardRef` so the composer `textareaRef` attaches cleanly. This is cosmetic and can be skipped.

## Validation
1. Deploy the edge function.
2. Open `/assistant`, send a message (e.g. "What are my top business expenses this year?").
3. Confirm the response streams in with no "Assistant error" toast.
4. Confirm the network response for `assistant-chat` carries `access-control-allow-origin: *` and the function logs no longer show "connection closed before message completed".
5. Verify tool calls (expenses/income/etc.) still render and the message persists on reload.

## Technical notes
- The earlier `Content-Type` removal was correct and stays as-is; the AI SDK's `DefaultChatTransport` sets it automatically.
- Accuracy of answers is governed by the existing read-only tools and financial-integrity filters, which are unchanged; once the stream is unblocked the assistant will return data-backed answers as designed.
