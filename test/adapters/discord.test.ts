import { test, expect, describe } from "bun:test";
import {
  createDiscordAdapterFromChannel,
  type DiscordChannel,
  type DiscordClient,
} from "../../src/adapters/discord.ts";

type MockMessage = {
  content: string;
  author: { id: string; bot: boolean };
  createdAt: Date;
};

function makeChannel(overrides: Partial<DiscordChannel> = {}): DiscordChannel {
  return {
    send: async () => ({ id: "123" }),
    messages: {
      fetch: async () => new Map(),
    },
    ...overrides,
  };
}

function makeClient(overrides: Partial<DiscordClient> = {}): DiscordClient {
  return {
    destroy: async () => {},
    ...overrides,
  };
}

describe("DiscordAdapter", () => {
  describe("sendEmbed", () => {
    test("sends an embed with title and body, returns message ID", async () => {
      let capturedOptions: unknown = null;

      const channel = makeChannel({
        send: async (options: unknown) => {
          capturedOptions = options;
          return { id: "123" };
        },
      });

      const adapter = createDiscordAdapterFromChannel(channel, makeClient());
      const messageId = await adapter.sendEmbed("Test Title", "Test Body");

      expect(messageId).toBe("123");

      const opts = capturedOptions as { embeds: { title: string; description: string }[] };
      expect(opts.embeds).toHaveLength(1);
      expect(opts.embeds[0].title).toBe("Test Title");
      expect(opts.embeds[0].description).toBe("Test Body");
    });
  });

  describe("collectReplies", () => {
    test("returns non-bot messages after the given message ID", async () => {
      const timestamp = new Date("2024-01-01T12:00:00Z");
      const messages = new Map<string, MockMessage>([
        [
          "msg1",
          {
            content: "Hello from user",
            author: { id: "user1", bot: false },
            createdAt: timestamp,
          },
        ],
        [
          "msg2",
          {
            content: "Bot message",
            author: { id: "bot1", bot: true },
            createdAt: timestamp,
          },
        ],
        [
          "msg3",
          {
            content: "Another user message",
            author: { id: "user2", bot: false },
            createdAt: timestamp,
          },
        ],
      ]);

      let capturedAfter: string | null = null;
      const channel = makeChannel({
        messages: {
          fetch: async ({ after }: { after: string }) => {
            capturedAfter = after;
            return messages as Map<string, MockMessage>;
          },
        },
      });

      const adapter = createDiscordAdapterFromChannel(channel, makeClient());
      const replies = await adapter.collectReplies("msg0");

      expect(capturedAfter).toBe("msg0");
      expect(replies).toHaveLength(2);
      expect(replies[0]).toEqual({
        text: "Hello from user",
        userId: "user1",
        timestamp: timestamp.toISOString(),
      });
      expect(replies[1]).toEqual({
        text: "Another user message",
        userId: "user2",
        timestamp: timestamp.toISOString(),
      });
    });

    test("returns empty array when no messages", async () => {
      const channel = makeChannel({
        messages: {
          fetch: async () => new Map<string, MockMessage>(),
        },
      });

      const adapter = createDiscordAdapterFromChannel(channel, makeClient());
      const replies = await adapter.collectReplies("msg0");

      expect(replies).toEqual([]);
    });

    test("returns empty array when all messages are from bots", async () => {
      const timestamp = new Date("2024-01-01T12:00:00Z");
      const messages = new Map<string, MockMessage>([
        [
          "msg1",
          {
            content: "Bot only",
            author: { id: "bot1", bot: true },
            createdAt: timestamp,
          },
        ],
      ]);

      const channel = makeChannel({
        messages: {
          fetch: async () => messages as Map<string, MockMessage>,
        },
      });

      const adapter = createDiscordAdapterFromChannel(channel, makeClient());
      const replies = await adapter.collectReplies("msg0");

      expect(replies).toEqual([]);
    });
  });

  describe("destroy", () => {
    test("calls client.destroy", async () => {
      let destroyCalled = false;
      const client = makeClient({
        destroy: async () => {
          destroyCalled = true;
        },
      });

      const adapter = createDiscordAdapterFromChannel(makeChannel(), client);
      await adapter.destroy();

      expect(destroyCalled).toBe(true);
    });
  });
});
