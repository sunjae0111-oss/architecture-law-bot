export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { address, jibunAddress } = req.body;
  if (!address) return res.status(400).json({ error: '주소가 없어요.' });

  let zoneName = '확인중';
  let zoneExtra = '';

  try {
    // 지번주소에서 시도/시군구/동/번지 파싱
    const addr = jibunAddress || address;

    // 카카오 지번주소 → 행정코드 추출
    const kakaoRes = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(addr)}`,
      { headers: { Authorization: `KakaoAK ${process.env.KAKAO_API_KEY}` } }
    );
    const kakaoData = await kakaoRes.json();
    const doc = kakaoData?.documents?.[0];

    if (doc?.address) {
      const a = doc.address;
      const bjdCode = a.b_code; // 법정동코드 10자리
      const mainNo = a.main_address_no?.padStart(4, '0') || '0000';
      const subNo = a.sub_address_no?.padStart(4, '0') || '0000';

      if (bjdCode) {
        // 토지이음 API 호출
        const lurisUrl = `https://apis.data.go.kr/1611000/nsdi/LandUseService/attr/getLandUseAttr?serviceKey=${process.env.LURIS_API_KEY}&pnu=${bjdCode}${mainNo}${subNo}&numOfRows=10&pageNo=1&resultType=json`;

        const lurisRes = await fetch(lurisUrl);
        const lurisData = await lurisRes.json();

        const items = lurisData?.body?.items;
        if (items && items.length > 0) {
          // 용도지역 필터링
          const zoneItems = items.filter(item =>
            item.prposAreaDstrcNm?.includes('지역') ||
            item.prposAreaDstrcNm?.includes('지구') ||
            item.prposAreaDstrcNm?.includes('구역')
          );

          if (zoneItems.length > 0) {
            zoneName = zoneItems[0].prposAreaDstrcNm;
            zoneExtra = zoneItems.map(z => z.prposAreaDstrcNm).join(', ');
          }
        }
      }
    }
  } catch(e) {
    console.log('zone lookup error:', e.message);
    // 오류 나도 AI 분석은 계속 진행
  }

  // Claude AI 분석
  const SYSTEM = `당신은 한국 건축 법규 전문 AI입니다. 반드시 순수 JSON만 반환하세요. 마크다운, 코드블록 절대 금지.

{"zone":"용도지역명","summary":"한줄 요약 (친근하게)","rules":[{"title":"건폐율","value":"XX%","desc":"쉬운 설명 (예: 100평 땅이면 XX평까지 지을 수 있어요)","law":"근거법령"},{"title":"용적률","value":"XXX%","desc":"쉬운 설명","law":"근거법령"},{"title":"최고 층수","value":"X층 이하","desc":"쉬운 설명","law":"근거법령"},{"title":"지을 수 있는 건물","value":"종류 나열","desc":"쉬운 설명","law":"근거법령"},{"title":"일조권 이격거리","value":"기준","desc":"쉬운 설명","law":"근거법령"},{"title":"주차 대수","value":"기준","desc":"쉬운 설명","law":"근거법령"}],"caution":"⚠️ 본 정보는 참고용이며, 실제 인허가는 담당 건축사·구청에서 확인하세요."}`;

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
          content: `주소: ${address}\n실제 용도지역: ${zoneName}\n추가 지역지구: ${zoneExtra || '없음'}\n\n위 실제 데이터를 기반으로 건축 법규를 JSON으로 분석해주세요.`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const raw = claudeData?.content?.[0]?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (zoneName !== '확인중') parsed.zone = zoneName;
    if (zoneExtra) parsed.zoneExtra = zoneExtra;

    res.status(200).json(parsed);
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message || '분석 중 오류가 발생했어요.' });
  }
}
