import { Client, GatewayIntentBits } from "discord.js";

export interface DiscordChannel {
  send(options: unknown): Promise<{ id: string }>;
  messages: {
    fetch(options: { after: string }): Promise<Map<string, { content: string; author: { id: string; bot: boolean }; createdAt: Date }>>;
  };
}

export interface DiscordClient {
  destroy(): Promise<void>;
}

export interface DiscordAdapter {
  sendEmbed(title: string, body: string): Promise<string>;
  collectReplies(afterMessageId: string): Promise<{ text: string; userId: string; timestamp: string }[]>;
  destroy(): Promise<void>;
}

export function createDiscordAdapterFromChannel(channel: DiscordChannel, client: DiscordClient): DiscordAdapter {
  return {
    async sendEmbed(title: string, body: string): Promise<string> {
      const message = await channel.send({ embeds: [{ title, description: body }] });
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
