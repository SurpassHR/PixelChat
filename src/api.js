import { getState } from './store.js';

export function buildApiUrl(base, path) {
  const cleanBase = (base || '').replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (cleanBase.endsWith('/v1') && cleanPath.startsWith('/v1/')) {
    return cleanBase + cleanPath.slice(3);
  }
  return cleanBase + cleanPath;
}

export function getApiConfig() {
  const { selectedProvider, providers } = getState();
  if (selectedProvider && providers[selectedProvider]) {
    return {
      base: providers[selectedProvider].base_url.replace(/\/+$/, ''),
      key: providers[selectedProvider].api_key || ''
    };
  }
  return { base: '', key: '' };
}

export async function fetchModels({ base, key }) {
  const res = await fetch(buildApiUrl(base, '/v1/models'), {
    headers: { Authorization: `Bearer ${key}` }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const models = data.data || data.models || [];
  if (models.length === 0) throw new Error('模型列表为空');
  return models.map(m => ({
    id: typeof m === 'string' ? m : m.id || m.name || '',
    owner: m.owned_by || ''
  }));
}

export async function generateImage({ base, key, model, prompt, refImages, signal }) {
  let content;
  if (refImages && refImages.length > 0) {
    content = [
      { type: 'text', text: prompt },
      ...refImages.map(img => ({
        type: 'image_url',
        image_url: { url: img.dataUrl }
      }))
    ];
  } else {
    content = prompt;
  }

  const body = {
    model,
    messages: [{ role: 'user', content }]
  };

  const res = await fetch(buildApiUrl(base, '/v1/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();

  let imageUrl = data.url || '';
  if (!imageUrl && data.choices?.[0]?.message?.content) {
    const content = data.choices[0].message.content;
    const mdMatch = content.match(/!\[.*?\]\((.*?)\)/);
    if (mdMatch) imageUrl = mdMatch[1];
    if (!imageUrl) {
      const urlMatch = content.match(/https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp)/i);
      if (urlMatch) imageUrl = urlMatch[0];
    }
  }
  if (imageUrl && imageUrl.startsWith('/')) {
    imageUrl = base + imageUrl;
  }

  return { imageUrl, rawData: data };
}
