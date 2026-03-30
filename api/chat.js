export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { address, coords } = req.body;

  // 1. 국토부 토지이음 API로 용도지역 조회
  let zoneInfo = null;
  try {
    const landUrl = `https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LP_PA_CBND_BUBUN&key=${process.env.VWORLD_API_KEY}&geometry=false&attribute=true&filter=<PropertyIsEqualTo><PropertyName>pnu</PropertyName><Literal>${coords.pnu}</Literal></PropertyIsEqualTo>`;
    // 간단히 AI에게 주소만 넘겨서 법규 설명하도록
  } catch(e) {}

  const SYSTEM = `당신은 한국 건축 법규 전문 AI입니다. 건축주(일반인)를 위해 쉽고 친근하게 설명해주세요.

사용자가 주소를 입력하면 아래 JSON 형식으로만 답변하세요. 다른 텍스트는 절대 포함하지 마세요.

{
  "zone": "용도지역명 (예: 제2종일반주거지역)",
  "summary": "이 땅에 대한 한줄 요약 (예: 4층 이하 주택 중심 지역이에요)",
  "rules": [
    {
      "title": "건폐율",
      "value": "60%",
      "desc": "100평 땅이면 건물 바닥면적을 60평까지 지을 수 있어요",
      "law": "건축법 시행령 제84조"
    },
    {
      "title": "용적률",
      "value": "200%",
      "desc": "100평 땅이면 연면적 합계를 200평까지 지을 수 있어요",
      "law": "건축법 시행령 제85조"
    },
    {
      "title": "최고 층수",
      "value": "4층 이하",
      "desc": "이 지역은 일반적으로 4층까지 허용돼요",
      "law": "각 지자체 조례"
    },
    {
      "title": "지을 수 있는 건물",
      "value": "단독주택, 다가구, 근린생활시설 등",
      "desc": "주거 중심 지역으로 소규모 상업시설도 일부 허용돼요",
      "law": "국토계획법 시행령 제71조"
    },
    {
      "title": "일조권 이격거리",
      "value": "인접 대지 경계에서 1m 이상",
      "desc": "북쪽 집의 햇빛을 가리지 않도록 건물 높이에 따라 거리를 둬야 해요",
      "law": "건축법 제61조"
    },
    {
      "title": "주차대수",
      "value": "세대당 1대 이상",
      "desc": "주택 규모에 따라 다르며 지자체 조례로 강화될 수 있어요",
      "law": "주차장법 시행령"
    }
  ],
  "caution": "실제 인허가 시 담당 건축사 및 해당 구청에 반드시 확인하세요."
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system: SYSTEM,
        messages: [{ role: 'user', content: `주소: ${address}\n이 주소의 건축 법규를 JSON으로 알려주세요.` }]
      })
    });
    const data = await response.json();
    const raw = data?.content?.[0]?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.status(200).json(parsed);
  } catch(err) {
    res.status(500).json({ error: '오류가 발생했어요.' });
  }
}
