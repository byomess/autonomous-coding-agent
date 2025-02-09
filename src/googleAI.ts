import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, GenerativeModel } from "@google/generative-ai";
import * as dotenv from 'dotenv';
import { GOOGLE_AI } from "./constants";
dotenv.config();

const API_KEY = process.env.GOOGLE_AI_API_KEY as string;

if (!API_KEY) {
    throw new Error("A chave da API do Google AI não está definida no arquivo .env");
}
export let model: GenerativeModel;
export async function setupGoogleAI() {
    const genAI = new GoogleGenerativeAI(API_KEY);
    model = genAI.getGenerativeModel({ model: GOOGLE_AI.MODELS.GEMINI_2v0_FLASH });
}

export async function generateContent(prompt: string, systemMessage?: string): Promise<string> {
    if (!model) {
        await setupGoogleAI();
    }
    const generationConfig = {
        temperature: 0.2,  // Lower temperature for more deterministic output
        topK: 50,
        topP: 0.9,
        maxOutputTokens: 4096,
    };

    const safetySettings = [
        {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
    ];

    const chat = model.startChat({
        generationConfig,
        safetySettings,
        systemInstruction: systemMessage ? { role: "user", parts: [{ text: systemMessage }]} : undefined, // Set system message
    });

    const result = await chat.sendMessage(prompt);

    if (!result || !result.response) {
        throw new Error("The Google AI Studio response is empty or undefined.");
    }

    const text = result.response.text();
    return text;
}