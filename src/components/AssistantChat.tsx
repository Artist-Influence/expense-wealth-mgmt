import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from '@/components/ai-elements/tool';
import { Shimmer } from '@/components/ai-elements/shimmer';
import assistantMark from '@/assets/assistant-mark.png';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const SUGGESTIONS = [
  'How much did I spend on dining last month?',
  'What are my top business expenses this year?',
  'How does the categorization engine work?',
  'How much do I still have outstanding in reimbursements?',
];

interface Props {
  threadId: string;
  ownerId: string;
  initialMessages: UIMessage[];
  canSend: boolean;
  onFirstMessage?: (text: string) => void;
}

export function AssistantChat({ threadId, ownerId, initialMessages, canSend, onFirstMessage }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${SUPABASE_URL}/functions/v1/assistant-chat`,
        prepareSendMessagesRequest: async ({ messages, id }) => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          return {
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: ANON_KEY,
              'Content-Type': 'application/json',
            },
            body: { messages, threadId: id, ownerId },
          };
        },
      }),
    [ownerId],
  );

  const { messages, sendMessage, status, error } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onError: (e) => {
      console.error(e);
      toast.error('Assistant error. Please try again.');
    },
  });

  // Keep the composer focused for normal chat use.
  useEffect(() => {
    textareaRef.current?.focus();
  }, [threadId]);
  useEffect(() => {
    if (status === 'ready') textareaRef.current?.focus();
  }, [status]);

  const isBusy = status === 'submitted' || status === 'streaming';

  const handleSubmit = (message: PromptInputMessage) => {
    const text = message.text?.trim();
    if (!text || !canSend || isBusy) return;
    if (messages.length === 0) onFirstMessage?.(text);
    sendMessage({ text });
  };

  const send = (text: string) => {
    if (!canSend || isBusy) return;
    if (messages.length === 0) onFirstMessage?.(text);
    sendMessage({ text });
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <Conversation className="flex-1 min-h-0">
        <ConversationContent className="max-w-3xl mx-auto w-full">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center py-16 px-4">
              <img
                src={assistantMark}
                alt="Finance assistant"
                width={64}
                height={64}
                loading="lazy"
                className="h-16 w-16 mb-4 drop-shadow-lg"
              />
              <h2 className="text-lg font-semibold text-foreground">Ask anything about your finances</h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                I can explain how the platform works and answer questions about your live expenses,
                income, allocations, tax reserves and reimbursements.
              </p>
              <div className="grid sm:grid-cols-2 gap-2 mt-6 w-full max-w-xl">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={!canSend}
                    className="text-left text-sm rounded-lg border border-border/60 bg-secondary/30 hover:bg-secondary/60 px-3 py-2.5 transition-colors disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <Message key={message.id} from={message.role}>
              <MessageContent>
                {message.parts.map((part, i) => {
                  if (part.type === 'text') {
                    return <MessageResponse key={i}>{part.text}</MessageResponse>;
                  }
                  if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
                    const toolPart = part as unknown as ToolPart;
                    const niceName =
                      toolPart.type === 'dynamic-tool'
                        ? (toolPart as { toolName: string }).toolName
                        : toolPart.type.replace(/^tool-/, '');
                    const title = niceName.replace(/_/g, ' ');
                    return (
                      <Tool key={i} defaultOpen={false}>
                        <ToolHeader
                          title={title}
                          type={'dynamic-tool'}
                          state={toolPart.state}
                          toolName={niceName}
                        />
                        <ToolContent>
                          <ToolInput input={toolPart.input} />
                          <ToolOutput output={toolPart.output} errorText={toolPart.errorText} />
                        </ToolContent>
                      </Tool>
                    );
                  }
                  return null;
                })}
              </MessageContent>
            </Message>
          ))}

          {status === 'submitted' && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer>Thinking…</Shimmer>
              </MessageContent>
            </Message>
          )}

          {error && (
            <p className="text-sm text-destructive text-center py-2">
              Something went wrong. Please try again.
            </p>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t border-border/60 p-3">
        <div className="max-w-3xl mx-auto w-full">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              ref={textareaRef}
              autoFocus
              disabled={!canSend}
              placeholder={canSend ? 'Ask about your finances or how the platform works…' : 'Read-only view'}
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit status={status} disabled={!canSend} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
