import { AppShell } from "@/components/app-shell";
import { ChatWorkspace } from "@/components/chat/chat-workspace";

export default function ConversationsPage() {
  return (
    <AppShell activeNav="conversations">
      <ChatWorkspace />
    </AppShell>
  );
}
