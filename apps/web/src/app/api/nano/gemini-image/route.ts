// [CUSTOM: START] - Gemini image generation API
import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { deductCredits } from "@/actions/usage/deduct";

export async function POST(request: NextRequest) {
  try {
    // Check authentication via Better Auth
    const session = await auth.api.getSession({ headers: await headers() });

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 },
      );
    }

    // Deduct 1 credit for the API call
    const deductResult = await deductCredits(1, "Nano AI image generation");
    if (!deductResult.success) {
      return NextResponse.json({ success: false, error: deductResult.error }, { status: 400 });
    }

    // Get API key from environment
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "Gemini API key not configured" },
        { status: 500 },
      );
    }

    // Parse request body
    const { prompt, image, mimeType } = await request.json();

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json({ success: false, error: "Prompt is required" }, { status: 400 });
    }

    if (!image || typeof image !== "string") {
      return NextResponse.json(
        { success: false, error: "Image data is required" },
        { status: 400 },
      );
    }

    // Initialize Google GenAI
    const genAI = new GoogleGenAI({ apiKey });

    // Configure the model for image generation
    const config = {
      responseModalities: ["IMAGE", "TEXT"],
    };

    const model = "gemini-2.5-flash-image-preview";

    const contents = [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              data: image,
              mimeType: mimeType,
            },
          },
          {
            text: prompt.trim(),
          },
        ],
      },
    ];

    // Generate content stream
    const response = await genAI.models.generateContentStream({
      model,
      config,
      contents,
    });

    const images: string[] = [];
    let textResponse = "";

    // Process the stream
    for await (const chunk of response) {
      if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
        continue;
      }

      // Check for image data
      if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
        const inlineData = chunk.candidates[0].content.parts[0].inlineData;
        if (inlineData.data && inlineData.mimeType?.includes("image")) {
          images.push(inlineData.data);
        }
      }

      // Collect text response
      if (chunk.text) {
        textResponse += chunk.text;
      }
    }

    if (images.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No images were generated. The model may not support image generation for this prompt.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        images,
        textResponse: textResponse || null,
        count: images.length,
      },
    });
  } catch (error: any) {
    console.error("Gemini Image Generation Error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to generate image",
      },
      { status: 500 },
    );
  }
}
// [CUSTOM: END]
