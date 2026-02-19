import Anthropic from '@anthropic-ai/sdk';

export const claude = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export async function generateInsight(
  prompt: string,
  context: Record<string, any>
) {
  const message = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system: 'You are Spine\'s behavioral finance AI. You help users understand how their sleep, stress, and activity affect their spending. Be direct, data-driven, and non-judgmental.',
    messages: [{
      role: 'user',
      content: `Context: ${JSON.stringify(context)}\n\nQuestion: ${prompt}`
    }],
  });

  return message.content[0].type === 'text'
    ? message.content[0].text
    : 'No response generated';
}