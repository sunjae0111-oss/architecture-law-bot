export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { address } = req.body;
  if (!address) return res.status(400).json({ error: '주소가 없어요.' });

  try {
    // STEP 1: 카카오 API로 주소 → 좌표 변환
    const kakaoRes = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`,
      { headers: { Authorization: `KakaoAK ${process.env.KAKAO_API_KEY}` } }
    );
    const kakaoData = await kakaoRes.json();
    const doc = kakaoData?.documents?.[0];
    if (!doc) return res.status(400).json({ error: '주소를 찾을 수 없어요.' });

    const x = doc.x; // 경도
    const y = doc.y; // 위도

    // STEP 2: 브이월드 API로 용도지역 조회
    const vworldRes = await fetch(
      `https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LT_C_UQ111&key=${process.env.VWORLD_API_KEY}&geometry=false&attribute=true&intersects=POINT(${x} ${y})&srsName=EPSG:4326`
    );
    const vworldData = await vworldRes.json();
    const feature = vworldData?.response?.result?.featureCollection?.features?.[0];
    const zoneCode = feature?.properties?.uq111 || '';
    const zoneName = feature?.properties?.uq111_nm || '확인불가';

    // STEP 3: Claude AI로 법규 분석
    const SYSTEM = `당신은 한국 건축 법규 전문 AI입니다. 아래 JSON 형식으로만 답변하세요. 마크다운이나 다른 텍스트는 절대 포함하지 마세요.

{
  "zone": "용도지역명",
  "summary": "이 땅 한줄 요약 (친근하게)",
  "rules": [
    {
      "title": "건폐율",
      "value": "60%",
      "desc": "100평 땅이라면 건물 바닥 60평까지 지을 수 있어요",
      "law": "건축법 시행령 제84조"
    },
    {
      "title": "용적률",
      "value": "200%",
      "desc": "연면적 합계 200평까지 가능해요",
      "law": "건축법 시행령 제85조"
    },
    {
      "title": "최고 층수",
      "value": "4층 이하",
      "desc": "일반적으로 4층까지 허용되나 지자체 조례로 다를 수 있어요",
      "law": "각 지자체 조례"
    },
    {
      "title": "지을 수 있는 건물",
      "value": "단독·다가구·근린생활시설 등",
      "desc": "주거 중심이며 소규모 상업시설 일부 허용",
      "law": "국토계획법 시행령 제71조"
    },
    {
      "title": "일조권 이격거리",
      "value": "높이의 1/2 이상",
      "desc": "북쪽 대지 경계에서 건물 높이에 따라 거리를 띄워야 해요",
      "law": "건축법 제61조"
    },
    {
      "title": "주차 대수",
      "value": "세대당 1대 이상",
      "desc": "전용면적 기준으로 의무 주차대수가 정해져요",
      "law": "주차장법 시행령 제6조"
    }
  ],
  "caution": "⚠️ 본 정보는 참고용이며, 실제 인허가는 담당 건축사·구청에서 반드시 확인하세요."
}`;

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
          content: `주소: ${address}\n실제 용도지역 코드: ${zoneCode}\n실제 용도지역명: ${zoneName}\n\n위 정보를 바탕으로 건축 법규를 JSON으로 분석해주세요.`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const raw = claudeData?.content?.[0]?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    // 실제 용도지역명 덮어쓰기
    if (zoneName && zoneName !== '확인불가') parsed.zone = zoneName;

    res.status(200).json(parsed);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '분석 중 오류가 발생했어요. 다시 시도해주세요.' });
  }
}
