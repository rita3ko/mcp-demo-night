import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// Create AI Gateway provider that uses Cloudflare's unified billing
export function createGatewayModel(env: {
  CF_ACCOUNT_ID: string;
  CF_GATEWAY_ID: string;
  CF_AIG_TOKEN: string;
}) {
  const baseURL = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/compat`;
  console.log('[Model] Creating gateway model with baseURL:', baseURL);
  console.log('[Model] CF_ACCOUNT_ID length:', env.CF_ACCOUNT_ID?.length);
  console.log('[Model] CF_GATEWAY_ID:', env.CF_GATEWAY_ID);
  console.log('[Model] CF_AIG_TOKEN length:', env.CF_AIG_TOKEN?.length);
  
  const client = createOpenAICompatible({
    name: 'cloudflare-ai-gateway',
    baseURL,
    headers: {
      'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
    },
    // Enable usage tracking in streaming responses
    includeUsage: true,
  });

  // Use anthropic/ prefix to route to Anthropic via compat endpoint
  return client('anthropic/claude-sonnet-4-5');
}

// For code generation in codemode, use OpenAI gpt-4.1 for reliable structured output
export function createCodeGenModel(env: {
  CF_ACCOUNT_ID: string;
  CF_GATEWAY_ID: string;
  CF_AIG_TOKEN: string;
}) {
  const client = createOpenAICompatible({
    name: 'cloudflare-ai-gateway',
    baseURL: `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/compat`,
    headers: {
      'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
    },
  });

  // Use OpenAI gpt-4.1 for code generation with structured outputs
  return client('openai/gpt-4.1', {
    structuredOutputs: true,
  });
}
