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
  mentions: { has(userId: string): boolean };
};

function mentionsOf(ids: string[]): { has(userId: string): boolean } {
  return { has: (id: string) => ids.includes(id) };
}

const noMentions = { has: () => false };

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
      expect(opts.embeds[0]!.title).toBe("Test Title");
      expect(opts.embeds[0]!.description).toBe("Test Body");
    });

  });

  describe("sendMessage", () => {
    test("sends plain content message and returns message ID", async () => {
      let capturedOptions: unknown = null;
      const channel = makeChannel({
        send: async (options: unknown) => { capturedOptions = options; return { id: "m1" }; },
      });
      const adapter = createDiscordAdapterFromChannel(channel, makeClient());
      const id = await adapter.sendMessage("Take a short break, you've been coding for a while.");
      expect(id).toBe("m1");
      const opts = capturedOptions as { content: string; embeds?: unknown };
      expect(opts.content).toBe("Take a short break, you've been coding for a while.");
      expect(opts.embeds).toBeUndefined();
    });

    test("prefixes mention when mentionUserId is provided", async () => {
      let capturedOptions: unknown = null;
      const channel = makeChannel({
        send: async (options: unknown) => { capturedOptions = options; return { id: "m2" }; },
      });
      const adapter = createDiscordAdapterFromChannel(channel, makeClient());
      await adapter.sendMessage("Stand up and stretch.", "user123");
      const opts = capturedOptions as { content: string };
      expect(opts.content).toContain("<@user123>");
      expect(opts.content).toContain("Stand up and stretch.");
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
            mentions: noMentions,
          },
        ],
        [
          "msg2",
          {
            content: "Bot message",
            author: { id: "bot1", bot: true },
            createdAt: timestamp,
            mentions: noMentions,
          },
        ],
        [
          "msg3",
          {
            content: "Another user message",
            author: { id: "user2", bot: false },
            createdAt: timestamp,
            mentions: noMentions,
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

      expect(capturedAfter as unknown as string).toBe("msg0");
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

    test("filters out messages from users other than allowedUserId", async () => {
      const timestamp = new Date("2024-01-01T12:00:00Z");
      const messages = new Map<string, MockMessage>([
        ["msg1", { content: "Allowed user", author: { id: "user1", bot: false }, createdAt: timestamp, mentions: noMentions }],
        ["msg2", { content: "Other user", author: { id: "user2", bot: false }, createdAt: timestamp, mentions: noMentions }],
        ["msg3", { content: "Bot", author: { id: "bot1", bot: true }, createdAt: timestamp, mentions: noMentions }],
      ]);

      const channel = makeChannel({
        messages: {
          fetch: async () => messages as Map<string, MockMessage>,
        },
      });

      const adapter = createDiscordAdapterFromChannel(channel, makeClient());
      const replies = await adapter.collectReplies("msg0", "user1");

      expect(replies).toHaveLength(1);
      expect(replies[0]!.text).toBe("Allowed user");
      expect(replies[0]!.userId).toBe("user1");
    });

    test("returns all non-bot messages when allowedUserId is omitted", async () => {
      const timestamp = new Date("2024-01-01T12:00:00Z");
      const messages = new Map<string, MockMessage>([
        ["msg1", { content: "User one", author: { id: "user1", bot: false }, createdAt: timestamp, mentions: noMentions }],
        ["msg2", { content: "User two", author: { id: "user2", bot: false }, createdAt: timestamp, mentions: noMentions }],
      ]);

      const channel = makeChannel({
        messages: {
          fetch: async () => messages as Map<string, MockMessage>,
        },
      });

      const adapter = createDiscordAdapterFromChannel(channel, makeClient());
      const replies = await adapter.collectReplies("msg0");

      expect(replies).toHaveLength(2);
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
            mentions: noMentions,
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

    test("when botUserId is set, drops messages that do not mention the bot", async () => {
      const timestamp = new Date("2024-01-01T12:00:00Z");
      const messages = new Map<string, MockMessage>([
        ["msg1", { content: "random chatter", author: { id: "user1", bot: false }, createdAt: timestamp, mentions: noMentions }],
        ["msg2", { content: "unrelated", author: { id: "user2", bot: false }, createdAt: timestamp, mentions: mentionsOf(["other-user"]) }],
      ]);

      const channel = makeChannel({
        messages: { fetch: async () => messages as Map<string, MockMessage> },
      });

      const adapter = createDiscordAdapterFromChannel(channel, makeClient(), "bot-id-123");
      const replies = await adapter.collectReplies("msg0");

      expect(replies).toEqual([]);
    });

    test("when botUserId is set, keeps messages that mention the bot (direct or reply)", async () => {
      const timestamp = new Date("2024-01-01T12:00:00Z");
      const messages = new Map<string, MockMessage>([
        ["msg1", { content: "@bot hello", author: { id: "user1", bot: false }, createdAt: timestamp, mentions: mentionsOf(["bot-id-123"]) }],
        ["msg2", { content: "reply to bot", author: { id: "user2", bot: false }, createdAt: timestamp, mentions: mentionsOf(["bot-id-123"]) }],
        ["msg3", { content: "nope", author: { id: "user3", bot: false }, createdAt: timestamp, mentions: noMentions }],
      ]);

      const channel = makeChannel({
        messages: { fetch: async () => messages as Map<string, MockMessage> },
      });

      const adapter = createDiscordAdapterFromChannel(channel, makeClient(), "bot-id-123");
      const replies = await adapter.collectReplies("msg0");

      expect(replies).toHaveLength(2);
      expect(replies.map((r) => r.text)).toEqual(["@bot hello", "reply to bot"]);
    });

    test("botUserId filter composes with allowedUserId", async () => {
      const timestamp = new Date("2024-01-01T12:00:00Z");
      const messages = new Map<string, MockMessage>([
        ["msg1", { content: "allowed + mentions bot", author: { id: "user1", bot: false }, createdAt: timestamp, mentions: mentionsOf(["bot-id-123"]) }],
        ["msg2", { content: "allowed but no mention", author: { id: "user1", bot: false }, createdAt: timestamp, mentions: noMentions }],
        ["msg3", { content: "other user mentions bot", author: { id: "user2", bot: false }, createdAt: timestamp, mentions: mentionsOf(["bot-id-123"]) }],
      ]);

      const channel = makeChannel({
        messages: { fetch: async () => messages as Map<string, MockMessage> },
      });

      const adapter = createDiscordAdapterFromChannel(channel, makeClient(), "bot-id-123");
      const replies = await adapter.collectReplies("msg0", "user1");

      expect(replies).toHaveLength(1);
      expect(replies[0]!.text).toBe("allowed + mentions bot");
    });

    test("without botUserId, mentions.has is ignored (regression guard)", async () => {
      const timestamp = new Date("2024-01-01T12:00:00Z");
      const messages = new Map<string, MockMessage>([
        ["msg1", { content: "no mentions", author: { id: "user1", bot: false }, createdAt: timestamp, mentions: noMentions }],
        ["msg2", { content: "mentions someone else", author: { id: "user2", bot: false }, createdAt: timestamp, mentions: mentionsOf(["someone"]) }],
      ]);

      const channel = makeChannel({
        messages: { fetch: async () => messages as Map<string, MockMessage> },
      });

      const adapter = createDiscordAdapterFromChannel(channel, makeClient());
      const replies = await adapter.collectReplies("msg0");

      expect(replies).toHaveLength(2);
    });
  });

  describe("getLatestMessageId", () => {
    test("returns the ID of the latest message", async () => {
      const messages = new Map<string, MockMessage>([
        [
          "latest-msg-id",
          {
            content: "Latest message",
            author: { id: "user1", bot: false },
            createdAt: new Date("2024-01-01T12:00:00Z"),
            mentions: noMentions,
          },
        ],
      ]);

      const channel = makeChannel({
        messages: {
          fetch: async () => messages as Map<string, MockMessage>,
        },
      });

      const adapter = createDiscordAdapterFromChannel(channel, makeClient());
      const latestId = await adapter.getLatestMessageId();

      expect(latestId).toBe("latest-msg-id");
    });

    test("returns null when channel has no messages", async () => {
      const channel = makeChannel({
        messages: {
          fetch: async () => new Map<string, MockMessage>(),
        },
      });

      const adapter = createDiscordAdapterFromChannel(channel, makeClient());
      const latestId = await adapter.getLatestMessageId();

      expect(latestId).toBeNull();
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
