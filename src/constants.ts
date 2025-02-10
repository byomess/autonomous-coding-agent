// src/constants.ts
export const GOOGLE_AI = {
  MODELS: {
    GEMINI_2v0_FLASH_THINKING_EXP_01_21: "gemini-2.0-flash-thinking-exp-01-21",
    GEMINI_2v0_FLASH: "gemini-2.0-flash",
  },
  SYSTEM_MESSAGES: {
    PLANNER: `
You are a highly skilled software development planning AI, specializing in creating comprehensive Scrum user stories.
You excel at understanding user requirements and translating them into well-defined Scrum stories, complete with detailed action plans.
You should generate a complete Scrum user story, with:
- Story title
- Story short description
- Story long description
- Acceptance criteria
- Plan (the step-by-step actions for delivering the requirements)
- Estimated time to complete each step

Your output should be a JSON object that strictly follows this structure:

\`\`\`json
{
  "title": "...",
  "shortDescription": "...",
  "longDescription": "...",
  "acceptanceCriteria": ["...", "..."],
  "plan": ["...", "..."],
  "estimatedHours": number,
  "dependencies": ["...", "..."],
   "risks": ["...", "..."],
  "notes": "..."

}
\`\`\`

The "plan" should include very specific instructions suitable for an AI coding agent, including file names, class structures, method signatures, and even testing strategies.
ONLY OUTPUT THE JSON OBJECT, with no additional text or explanations.
`,
  },
  PROMPTS: {
    PLANNER: `
Create a comprehensive Scrum user story based on the following requirements.

Project Title: {%PROJECT_TITLE%}
Project Description: {%PROJECT_DESCRIPTION%}

User Requirements:
{%REQUIREMENTS%}

Additional Details:
{%ADDITIONAL_DETAILS%}

- Output ONLY the JSON object, as defined in the system message, with no additional text or explanations
- DO NOT create more than 5 tasks for the action plan (the less tasks, the better)
- DO NOT PROVIDE THE CODE IMPLEMENTATION, only the user story and action plan, that further will be used by the AI coding agent
- Avoid including tasks for implementing functionalities that are not explicitly mentioned in the requirements
`,
  },
};

export const NODE_BIN_PATH = "/home/byomess/.nvm/versions/node/v23.1.0/bin/node";
export const NPM_BIN_PATH = "/home/byomess/.nvm/versions/node/v23.1.0/bin/npm";

export const TEST_COMMAND = `${NPM_BIN_PATH} run test`;