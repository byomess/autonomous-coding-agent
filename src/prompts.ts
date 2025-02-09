// src/prompts.ts

import { UserRequirements, ScrumStory } from './types';
import { GOOGLE_AI } from './constants';

export function clarifyRequirementsPrompt(requirements: UserRequirements): string {
    let initialPrompt = `I am developing a software project. The user has provided the following initial requirement:\n${requirements.description}\n`;
    
    if (Object.keys(requirements.additionalDetails).length > 0) {
        initialPrompt += "We have already collected the following details:\n";
        for (const [question, answer] of Object.entries(requirements.additionalDetails)) {
            initialPrompt += `Question: ${question}\nAnswer: ${answer}\n`;
        }
    }
    
    initialPrompt += "What specific questions should I ask the user to gather all necessary information for creating a detailed Scrum user story and implementation plan? Focus on questions that will clarify the user's needs, acceptance criteria, and any technical constraints or preferences.  Respond in the format 'Question: ...'";  // Only ask questions, no answers.
    return initialPrompt;
}

export function createScrumStoryPrompt(requirements: UserRequirements, fileContents: { [filePath: string]: string } = {}): string {
    let prompt = GOOGLE_AI.PROMPTS.PLANNER;
    
    prompt = prompt.replace('{%PROJECT_TITLE%}', requirements.projectTitle || 'Unnamed Project');
    prompt = prompt.replace('{%PROJECT_DESCRIPTION%}', requirements.projectDescription || 'No project description provided.');
    prompt = prompt.replace('{%REQUIREMENTS%}', requirements.description);
    
    let additionalDetails = '';
    if(requirements.additionalDetails){
        for (const [question, answer] of Object.entries(requirements.additionalDetails)) {
            additionalDetails += `Question: ${question}\nAnswer: ${answer}\n`;
        }
    }
    prompt = prompt.replace('{%ADDITIONAL_DETAILS%}', additionalDetails);
    
    // Add file contents to the prompt
    if (Object.keys(fileContents).length > 0) {
        prompt += `\n\nCurrent Relevant File Contents:\n`;
        for (const [filePath, content] of Object.entries(fileContents)) {
            prompt += `\n--- ${filePath} ---\n${content}\n`;
        }
    }
    
    return prompt;
}