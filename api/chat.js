export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { address, x, y } = req.body;
  if (!address) return res.status(400).json({ error: '주소가 없어요.' });

  let zoneName = '확인중';

  // 브이월드로 용도지역 조회 (좌표가 있을 때만)
  if (x && y) {
    try {
      const vworldRes = await fetch(
        `https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LT_C_UQ111&key=${process.env.VWORLD_API_KEY}&geometry=false&attribute=true&intersects=POINT(${x} ${y})&srsName=EPSG:4326`
      );
      const vworldData = await vworldRes.json();
      const feature = vworldData?.response?.result?.featureCollection?.features?.[0];
      if (feature?.properties?.uq111_nm) {
        zoneName = feature.properties.uq111_nm;
      }
    } catch(e) {
      console.log('vworld error:', e.message);
    }
  }

  // Claude AI 분석
  const SYSTEM = `당신은 한국 건축 법규 전문 AI입니다. 반드시 순수 JSON만 반환하세요. 마크다운, 코드블록 절대 금지.

{"zone":"용도지역명","summary":"한줄 요약 (친근하게)","rules":[{"title":"건폐율","value":"XX%","desc":"쉬운 설명 (예시 포함)","law":"근거법령"},{"title":"용적률","value":"XXX%","desc":"쉬운 설명","law":"근거법령"},{"title":"최고 층수","value":"X층 이하","desc":"쉬운 설명","law":"근거법령"},{"title":"지을 수 있는 건물","value":"종류 나열","desc":"쉬운 설명","law":"근거법령"},{"title":"일조권 이격거리","value":"기준","desc":"쉬운 설명","law":"근거법령"},{"title":"주차 대수","value":"기준","desc":"쉬운 설명","law":"근거법령"}],"caution":"⚠️ 본 정보는 참고용이며, 실제 인허가는 담당 건축사·구청에서 확인하세요."}`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
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
        messages: [{
          role: 'user',
          content: `주소: ${address}\n용도지역: ${zoneName}\n\n이 주소의 건축 법규를 JSON으로 분석해주세요.`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const raw = claudeData?.content?.[0]?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (zoneName !== '확인중') parsed.zone = zoneName;

    res.status(200).json(parsed);
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message || '분석 중 오류가 발생했어요.' });
  }
}
