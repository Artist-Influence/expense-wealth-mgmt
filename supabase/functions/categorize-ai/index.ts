import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { descriptions, allowedCategories, mode } = await req.json();

    if (!descriptions || !Array.isArray(descriptions) || descriptions.length === 0) {
      return new Response(JSON.stringify({ error: "descriptions array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!allowedCategories || !Array.isArray(allowedCategories) || allowedCategories.length === 0) {
      return new Response(JSON.stringify({ error: "allowedCategories array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const categoryList = allowedCategories.join(", ");
    const descriptionList = descriptions
      .map((d: { index: number; raw: string; normalized: string }, i: number) =>
        `[${i}] Raw: "${d.raw}" | Normalized: "${d.normalized}"`
      )
      .join("\n");

    const systemPrompt = `You are an expense categorization assistant for ${mode} expenses. You must categorize bank/credit card transaction descriptions into exactly one of these allowed categories: ${categoryList}.

Rules:
- ONLY use categories from the allowed list above. Never invent new categories.
- Infer the merchant/entity from the description (e.g. "AMZN MKTP US" = Amazon, "SQ *JOES COFFEE" = coffee shop).
- Use common merchant knowledge to pick the best category.
- If truly ambiguous, return null for category with low confidence.
- Return a brief explanation of your reasoning.
- For each transaction, also suggest:
  - The most likely transaction mode: "personal", "business", or "reimbursable_work"
  - The most likely tax treatment: "unknown", "likely_deductible", "likely_nondeductible", "capital_or_investment", "transfer_nonexpense"
  - Whether this is likely a reimbursable work expense (true/false)`;

    const userPrompt = `Categorize these ${descriptions.length} transactions. For each, return the best category, confidence, explanation, inferred merchant, suggested mode, suggested tax treatment, and whether likely reimbursable.

Transactions:
${descriptionList}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "categorize_transactions",
              description: "Return categorization results for each transaction",
              parameters: {
                type: "object",
                properties: {
                  results: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        index: { type: "number", description: "Transaction index from input" },
                        category: { type: "string", description: "Best matching category from allowed list, or null if unknown", nullable: true },
                        confidence: { type: "number", description: "Confidence score 0-95" },
                        explanation: { type: "string", description: "Brief reason for the categorization" },
                        inferred_merchant: { type: "string", description: "What merchant/entity this likely is" },
                        suggested_mode: { type: "string", description: "Suggested transaction mode: personal, business, or reimbursable_work", enum: ["personal", "business", "reimbursable_work"] },
                        suggested_tax_treatment: { type: "string", description: "Suggested tax treatment", enum: ["unknown", "likely_deductible", "likely_nondeductible", "capital_or_investment", "transfer_nonexpense"] },
                        likely_reimbursable: { type: "boolean", description: "Whether this is likely a reimbursable work expense" },
                      },
                      required: ["index", "category", "confidence", "explanation", "inferred_merchant", "suggested_mode", "suggested_tax_treatment", "likely_reimbursable"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["results"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "categorize_transactions" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required. Please add credits to your workspace." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      return new Response(JSON.stringify({ error: "AI gateway error", details: errText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.error("No tool call in response:", JSON.stringify(data));
      return new Response(JSON.stringify({ error: "AI did not return structured output", results: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(toolCall.function.arguments);
    } catch {
      console.error("Failed to parse tool call arguments:", toolCall.function.arguments);
      return new Response(JSON.stringify({ error: "Failed to parse AI response", results: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validated = (parsed.results || []).map((r: any) => {
      const catLower = r.category ? r.category.toLowerCase() : null;
      const matchedCategory = catLower
        ? allowedCategories.find((c: string) => c.toLowerCase() === catLower) || null
        : null;
      return {
        index: r.index,
        category: matchedCategory,
        confidence: Math.min(r.confidence || 0, 95),
        explanation: `AI: ${r.inferred_merchant || 'Unknown'} → ${matchedCategory || 'unresolved'}. ${r.explanation || ''}`,
        inferred_merchant: r.inferred_merchant || null,
        suggested_mode: r.suggested_mode || null,
        suggested_tax_treatment: r.suggested_tax_treatment || null,
        likely_reimbursable: r.likely_reimbursable || false,
      };
    });

    return new Response(JSON.stringify({ results: validated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("categorize-ai error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
