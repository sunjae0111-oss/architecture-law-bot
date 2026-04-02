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

  // ===== STEP 1: 카카오로 지번주소 → 법정동코드 + 번지 추출 =====
  try {
    const addr = jibunAddress || address;
    const kakaoRes = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(addr)}`,
      { headers: { Authorization: `KakaoAK ${process.env.KAKAO_API_KEY}` } }
    );
    const kakaoData = await kakaoRes.json();
    const doc = kakaoData?.documents?.[0];

    if (doc?.address) {
      const a = doc.address;
      const bjdCode = a.b_code;                              // 법정동코드 10자리
      const mainNo = a.main_address_no?.padStart(4, '0') || '0000';
      const subNo  = a.sub_address_no?.padStart(4, '0')  || '0000';

      if (bjdCode) {
        // ===== STEP 2: 토지이음 API로 실제 용도지역 조회 =====
        // 산 여부: 카카오 mountain_yn이 'Y'면 '2', 아니면 '1'
        const mountainYn = a.mountain_yn === 'Y' ? '2' : '1';
        const lurisUrl = `https://apis.data.go.kr/1611000/nsdi/LandUseService/attr/getLandUseAttr`
          + `?serviceKey=${process.env.LURIS_API_KEY}`
          + `&pnu=${bjdCode}${mainNo}${subNo}`
          + `&numOfRows=20&pageNo=1&resultType=json`;

        const lurisRes  = await fetch(lurisUrl);
        const lurisData = await lurisRes.json();
        console.log('LURIS RAW:', JSON.stringify(lurisData)); // 디버깅용

        const items = lurisData?.body?.items;

        if (items && items.length > 0) {
          // ✅ 정확한 용도지역명만 필터링 (지구·구역 제외)
          const ZONE_KEYWORDS = [
            '제1종전용주거지역', '제2종전용주거지역',
            '제1종일반주거지역', '제2종일반주거지역', '제3종일반주거지역',
            '준주거지역',
            '중심상업지역', '일반상업지역', '근린상업지역', '유통상업지역',
            '전용공업지역', '일반공업지역', '준공업지역',
            '보전녹지지역', '생산녹지지역', '자연녹지지역',
            '보전관리지역', '생산관리지역', '계획관리지역',
            '농림지역', '자연환경보전지역'
          ];

          // 용도지역만 추출
          const zoneItem = items.find(item =>
            ZONE_KEYWORDS.some(keyword =>
              item.prposAreaDstrcNm?.replace(/\s/g, '').includes(keyword)
            )
          );

          // 나머지 지역지구 (재정비촉진지구, 토지거래허가구역 등)
          const extraItems = items.filter(item =>
            !ZONE_KEYWORDS.some(keyword =>
              item.prposAreaDstrcNm?.replace(/\s/g, '').includes(keyword)
            )
          );

          if (zoneItem) {
            zoneName  = zoneItem.prposAreaDstrcNm.trim();
            zoneExtra = extraItems.map(z => z.prposAreaDstrcNm).join(', ');
          }
        } // end if items
      } // end if bjdCode
    } // end if doc?.address
  } catch(e) {
    console.log('zone lookup error:', e.message);
    // 오류가 나도 AI 분석은 계속 진행
  }

  // ===== STEP 3: Claude AI로 법규 분석 =====
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
    const raw   = claudeData?.content?.[0]?.text || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (zoneName !== '확인중') parsed.zone = zoneName;
    if (zoneExtra) parsed.zoneExtra = zoneExtra;

    res.status(200).json(parsed);

  } catch (err) {
    console.error('Claude error:', err.message);
    res.status(500).json({ error: err.message || '분석 중 오류가 발생했어요.' });
  }
}
