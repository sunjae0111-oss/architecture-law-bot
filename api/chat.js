export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const SYSTEM = `당신은 한국 건축 법규 전문 AI 도우미입니다. 집을 짓거나 리모델링하려는 일반인(건축주)을 위해 건축 법규를 쉽고 친근하게 설명해줍니다.
[답변 규칙]
1. 전문 용어는 반드시 괄호 안에 쉬운 설명 추가 (예: 건폐율(대지 면적 중 건물이 차지하는 비율))
2. 숫자는 구체적인 예시로 설명 (예: 100평 땅이라면 60평까지 지을 수 있어요)
3. 답변 끝에 근거 법령 명시: 📋 근거: 건축법 시행령 제X조
4. 마지막 줄: ⚠️ 본 내용은 참고용이며, 실제 인허가는 담당 건축사와 확인하세요.
5. 모르는 내용은 솔직히 "정확한 확인이 필요합니다"라고 안내
[범위] 건폐율·용적률·층수, 용도지역·변경, 주차대수, 일조권·이격거리, 대지면적 법규`;

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
        max_tokens: 1000,
        system: SYSTEM,
        messages: [{ role: 'user', content: message }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '답변을 가져오지 못했어요.';
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: '서버 오류가 발생했어요.' });
  }
}
