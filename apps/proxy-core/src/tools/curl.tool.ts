// apps/proxy-core/src/tools/curl-tool.ts
import type { InjectableTool } from './types.js';

export const curlTool: InjectableTool = {
  name: 'curl_proxy',
  description: 'Use this tool to fetch data from a local service or API. ' +
               'The Proxy will execute the curl command internally and return the content.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch (e.g., http://localhost:8080/api)' },
      method: { type: 'string', enum: ['GET', 'POST'], default: 'GET' },
      body: { type: 'string', description: 'JSON string body for POST requests' }
    },
    required: ['url']
  },
  enabled: true,
  async exec(input) {
    try {
      const { url, method = 'GET', body } = input;
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? body : undefined
      });

      const data = await response.text();
      return `Successfully fetched from ${url}:\n\n${data.substring(0, 2000)}`; // 限制长度防止溢出
    } catch (error: any) {
      return `Error fetching local service: ${error.message}`;
    }
  }
};