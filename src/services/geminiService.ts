export async function suggestShifts(employees: any[], shiftRequests: any[]) {
  try {
    const response = await fetch("/api/suggest-shifts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ employees, shiftRequests }),
    });

    if (!response.ok) {
      throw new Error("Failed to get suggestions from server");
    }

    return await response.json();
  } catch (error) {
    console.error("Client Gemini Error:", error);
    return [];
  }
}
