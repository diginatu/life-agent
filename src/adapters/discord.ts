import { Client, GatewayIntentBits } from "discord.js";

export interface DiscordChannel {
  send(options: unknown): Promise<{ id: string }>;
  messages: {
    fetch(options: { after: string } | { limit: number }): Promise<Map<string, { content: string; author: { id: string; bot: boolean }; createdAt: Date }>>;
  };
}

export interface DiscordClient {
  destroy(): Promise<void>;
}

export interface DiscordAdapter {
  sendEmbed(title: string, body: string, mentionUserId?: string): Promise<string>;
  collectReplies(afterMessageId: string): Promise<{ text: string; userId: string; timestamp: string }[]>;
  getLatestMessageId(): Promise<string | null>;
  destroy(): Promise<void>;
}

export function createDiscordAdapterFromChannel(channel: DiscordChannel, client: DiscordClient): DiscordAdapter {
  return {
    async sendEmbed(title: string, body: string, mentionUserId?: string): Promise<string> {
      const opts: Record<string, unknown> = { embeds: [{ title, description: body }] };
      if (mentionUserId) opts.content = `<@${mentionUserId}>`;
      const message = await channel.send(opts);
      return message.id;
    },

    async collectReplies(afterMessageId: string): Promise<{ text: string; userId: string; timestamp: string }[]> {
      const messages = await channel.messages.fetch({ after: afterMessageId });
      const replies: { text: string; userId: string; timestamp: string }[] = [];
      for (const [, message] of messages) {
        if (!message.author.bot) {
          replies.push({
            text: message.content,
            userId: message.author.id,
            timestamp: message.createdAt.toISOString(),
          });
        }
      }
      return replies;
    },

    async getLatestMessageId(): Promise<string | null> {
      const messages = await channel.messages.fetch({ limit: 1 });
      if (messages.size === 0) return null;
      const [id] = messages.keys();
      return id!;
    },

    async destroy(): Promise<void> {
      await client.destroy();
    },
  };
}

export async function createDiscordAdapter(token: string, channelId: string): Promise<DiscordAdapter> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  await client.login(token);

  const channel = await client.channels.fetch(channelId);

  return createDiscordAdapterFromChannel(channel as unknown as DiscordChannel, client);
}
