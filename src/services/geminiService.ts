import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function suggestShifts(employees: any[], shiftRequests: any[]) {
  const prompt = `
    تحليل وتوزيع الشيفتات الذكية.
    الموظفين: ${JSON.stringify(employees)}
    الطلبات: ${JSON.stringify(shiftRequests)}
    
    الرجاء اقتراح جدول عمل عادل يراعي توفر الموظفين وكفاءتهم.
    قم بالرد بتنسيق JSON يحتوي على مصفوفة من الشيفتات المقترحة.
    كل شيفت يجب أن يحتوي على: title, userId, startTime, endTime.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    
    const text = response.text || "";
    // Simplified parsing logic
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch (error) {
    console.error("Error generating smart shifts:", error);
    return [];
  }
}
