// src/agent.ts
import { stdin as input, stdout as output } from 'process';
import * as fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';

import { UserRequirements, ScrumStory, CommitOptions } from './types';
import { generateContent } from './googleAI';
import { createOrModifyProject, commitChanges } from './codeManager';
import { runTests, getProjectFiles } from './testRunner';
import * as prompts from './prompts';
import { GOOGLE_AI, TEST_COMMAND } from './constants';
import * as readline from 'readline/promises';
import { extractJson } from './utils'; // Import extractJson
import { Logger } from './logger';


export class Agent {
    private requirements: UserRequirements | null = null;
    private scrumStory: ScrumStory | null = null;
    private testCommand: string = TEST_COMMAND;
    private currentIterationDescription: string = "";
    private logger: Logger;

    constructor() {
        this.logger = new Logger();
    }

    async collectRequirements(
        initialDescription: string,
        repoPath?: string,
        noQuestions: boolean = false
    ): Promise<void> {
        this.logger.debug("Entering collectRequirements");

        if(!this.requirements){
            this.requirements = {
                description: initialDescription,
                repositoryPath: repoPath,
                additionalDetails: {},
            };
        } else {
            this.requirements.description = initialDescription;
            this.requirements.repositoryPath = repoPath
        }

        this.logger.debug(`Initial requirements set: ${JSON.stringify(this.requirements)}`);
        this.logger.debug(`No questions flag: ${noQuestions}`);

        if (noQuestions) {
            this.logger.info("Skipping clarifying questions as per --no-questions flag.");
            this.logger.info(chalk.green(`Collected Requirements: ${JSON.stringify(this.requirements)}`));
            return;
        }

        let continueAsking = true;
        while (continueAsking) {
            const prompt = prompts.clarifyRequirementsPrompt(this.requirements);
            this.logger.debug(`Clarification prompt: ${prompt}`);

            const details = await generateContent(prompt);
            this.logger.debug(`Gemini response for clarification: ${details}`);

            if (!details) {
                throw new Error("Failed to get additional details from Google Gemini.");
            }

            const hasFurtherQuestions = details.toLowerCase().includes("question:");

            if (!hasFurtherQuestions) {
                continueAsking = false;
            } else {
                const questionMatch = details.match(/Question:(.*)/i);
                if (questionMatch) {
                    const question = questionMatch[1].trim();
                    this.logger.debug(`Extracted question: ${question}`);

                    const answer = await this.askQuestion(question);
                    this.logger.debug(`User answer: ${answer}`);

                    this.requirements.additionalDetails[question] = answer;
                } else {
                    this.logger.warn(`Could not process details. Gemini responded: ${details}`);
                }
            }
        }
        this.logger.info(chalk.green(`Collected Requirements: ${JSON.stringify(this.requirements)}`));
    }

    async createActionPlan(): Promise<ScrumStory> {
        this.logger.debug("Entering createActionPlan");
        if (!this.requirements || !this.requirements.repositoryPath) {
            throw new Error('Requirements (including repository path) must be collected before creating the action plan.');
        }

        const projectFiles = await getProjectFiles(this.requirements.repositoryPath);
        this.logger.debug(`Project files: ${JSON.stringify(projectFiles)}`);

        let neededFiles: string[] = [];
        let continueGettingFiles = true;

        while (continueGettingFiles) {
            const filePrompt = this.generateFileRequestPromptForPlanning(projectFiles, neededFiles);
            this.logger.debug(`File request prompt (planning): ${filePrompt}`);

            const fileListResponse = await generateContent(filePrompt);
            this.logger.debug(`Gemini response for file list (planning): ${fileListResponse}`);

            if (!fileListResponse) {
                throw new Error("Failed to get file list from Google Gemini.");
            }

            if (fileListResponse.toLowerCase().includes("no more files")) {
                continueGettingFiles = false;
            } else {
                // Use extractJson here
                const jsonResult = extractJson(fileListResponse);
                if (jsonResult.success && Array.isArray(jsonResult.data)) {
                    neededFiles = [...new Set([...neededFiles, ...jsonResult.data])];
                } else {
                    this.logger.warn(`Gemini did not return a valid array of files: ${fileListResponse}`);
                    if (jsonResult.error) {
                        this.logger.debug(`Extraction error: ${jsonResult.error}`);
                    }
                }
            }
        }
        this.logger.debug(`Files needed for planning: ${JSON.stringify(neededFiles)}`);

        const fileContents = await this.getFileContentsMap(neededFiles, this.requirements.repositoryPath);
        this.logger.debug(`File contents retrieved (planning): ${JSON.stringify(fileContents)}`);

        const prompt = prompts.createScrumStoryPrompt(this.requirements, fileContents);
        this.logger.debug(`Scrum story prompt: ${prompt}`);

        const storyText = await generateContent(prompt, GOOGLE_AI.SYSTEM_MESSAGES.PLANNER);
        this.logger.debug(`Gemini response for Scrum story: ${storyText}`);

        if (!storyText) {
            throw new Error("Failed to create an action plan with Google Gemini.");
        }

        // Use extractJson here
        const jsonResult = extractJson(storyText);
        if (jsonResult.success) {
            this.scrumStory = jsonResult.data as ScrumStory;
            this.logger.debug(`Parsed Scrum story: ${JSON.stringify(this.scrumStory)}`);
            return this.scrumStory;
        } else {
            this.logger.error(`Error parsing Scrum story JSON: ${storyText}`);
            this.logger.error(`Extraction error: ${jsonResult.error}`); // Log the specific error
            throw new Error(`Failed to parse Scrum story from Gemini: ${jsonResult.error}`);
        }
    }

    async develop(scrumStory: ScrumStory): Promise<void> {
        this.logger.debug("Entering develop");

        if (!this.requirements || !this.requirements.repositoryPath) {
            throw new Error("Requirements (including repository path) not collected.")
        }

        let iterationCount = 0;
        const maxIterations = 10;

        const projectFiles = await getProjectFiles(this.requirements.repositoryPath);
        this.logger.debug(`Project files: ${JSON.stringify(projectFiles)}`);


        while (iterationCount < maxIterations) {
            iterationCount++;

            this.logger.info(chalk.blue(`Starting development iteration #${iterationCount}...`));

            this.currentIterationDescription = "";

             let neededFiles: string[] = [];
            let continueGettingFiles = true;

             while(continueGettingFiles){
                const filePrompt = this.generateFileRequestPrompt(projectFiles, neededFiles);
                this.logger.debug(`File request prompt: ${filePrompt}`);

                const fileListResponse = await generateContent(filePrompt);
                this.logger.debug(`Gemini response for file list: ${fileListResponse}`);

                if (!fileListResponse) {
                    throw new Error("Failed to get file list from Google Gemini.");
                }

                if (fileListResponse.toLowerCase().includes("no more files")) {
                    continueGettingFiles = false;
                } else {
                    // Use extractJson here
                    const jsonResult = extractJson(fileListResponse);
                    if (jsonResult.success && Array.isArray(jsonResult.data)) {
                        neededFiles = [...new Set([...neededFiles, ...jsonResult.data])];
                    } else {
                        this.logger.warn(`Gemini did not return a valid array of files: ${fileListResponse}`);
                        if (jsonResult.error) {
                            this.logger.debug(`Extraction error: ${jsonResult.error}`);
                        }
                    }
                 }
             }
            this.logger.debug(`Files needed for this iteration: ${JSON.stringify(neededFiles)}`);

            const fileContents = await this.getFileContentsMap(neededFiles, this.requirements.repositoryPath);
            this.logger.debug(`File contents retrieved: ${JSON.stringify(fileContents)}`);


            const codePrompt = this.generateCodePromptFromScrumStory(scrumStory, fileContents, this.currentIterationDescription);
            this.logger.debug(`Code generation prompt: ${codePrompt}`);

            const codeResponse = await generateContent(codePrompt);
            this.logger.debug(`Gemini response for code generation: ${codeResponse}`);

            if (!codeResponse) {
                throw new Error("Failed to generate code with Google Gemini.");
            }

            const jsonResult = extractJson(codeResponse);
            if (jsonResult.success) {
                const files = jsonResult.data as { [key: string]: string };
                this.logger.debug(`Parsed files: ${JSON.stringify(files)}`);
                this.currentIterationDescription = await this.generateIterationDescription(files);
                await createOrModifyProject(this.requirements.repositoryPath, files);
                this.logger.debug(`Files created/modified in ${this.requirements.repositoryPath}: ${JSON.stringify(files)}`);
            } else {
                this.logger.error(`Gemini did not return valid JSON: ${codeResponse}`);
                this.logger.error(`Extraction error: ${jsonResult.error}`); // Log error
                continue; // Try again
            }

            const testResult = await runTests(this.testCommand);
            this.logger.debug(testResult.passed ? chalk.green('Tests passed!') : chalk.red('Tests failed!'));
            this.logger.debug(`Test results: ${JSON.stringify(testResult)}`);

            if (testResult.passed) {
                break;
            } else {
                if (!this.requirements) {
                    throw new Error("Requirements not collected");
                }
                this.requirements.additionalDetails['testErrors'] = testResult.details || 'Tests failed without details.';
                this.logger.error(`Tests failed. Details: ${testResult.details}`);
            }
        }

        if (iterationCount === maxIterations) {
            this.logger.warn('Maximum number of iterations reached. There might be unresolved issues.');
        }
    }


    async reviewAndCommit(options: CommitOptions): Promise<void> {
        this.logger.debug("Entering reviewAndCommit");
        if (!this.requirements?.repositoryPath) {
            this.logger.warn("Not a repository. Cannot commit.");
            return;
        }
        await commitChanges(this.requirements.repositoryPath, options);
    }

    private async askQuestion(question: string): Promise<string> {
        const rl = readline.createInterface({ input, output });
        const answer = await rl.question(chalk.yellow(question) + " ");
        rl.close();
        return answer;
    }

    private generateCodePromptFromScrumStory(scrumStory: ScrumStory, fileContents: { [filePath: string]: string }, iterationDescription: string): string {
        this.logger.debug("Entering generateCodePromptFromScrumStory");
        let prompt = `Implement the following code in TypeScript, strictly following the Scrum story plan below. Use Test-Driven Development (TDD), starting with the tests. Return a JSON object with file names and content.  Example: { "src/file1.ts": "// ...", "test/file1.test.ts": "// ..." }\n\n`;
        prompt += `Scrum Story:\n`;
        prompt += `Title: ${scrumStory.title}\n`;
        prompt += `Short Description: ${scrumStory.shortDescription}\n`;
        prompt += `Long Description: ${scrumStory.longDescription}\n`;
        prompt += `Acceptance Criteria:\n${scrumStory.acceptanceCriteria.join('\n')}\n\n`;
        prompt += `Plan:\n${scrumStory.plan.join('\n')}\n\n`;

        if (Object.keys(fileContents).length > 0) {
            prompt += `\nCurrent Relevant File Contents:\n`;
            for (const [filePath, content] of Object.entries(fileContents)) {
                prompt += `\n--- ${filePath} ---\n${content}\n`;
            }
        }

        if(iterationDescription){
            prompt += `\n\nPrevious Iteration Description:\n${iterationDescription}`
        }

        prompt += '\n';
        prompt += `Your MUST respond using the following format, as an example:\n`;
        prompt += `{\n  "src/file1.ts": "export class MyClass { ... }",\n  "test/file1.test.ts": "describe('MyClass', () => { ... })"\n}\n\n`;

        this.logger.debug(`Generated code prompt: ${prompt}`);
        return prompt;
    }

    private generateFileRequestPrompt(projectFiles: string[], alreadyRequested: string[]): string {
        let prompt = `Based on the Scrum story and the project's file structure, which files do you need to examine to implement the next step?  Return a JSON array of file paths, relative to the project root. Example: ["src/file1.ts", "src/utils/helper.ts"]. If you have enough information and don't need to see any more files, return "No more files".\n\n`;
        prompt += `Existing project Files:\n${projectFiles.join('\n')}\n\n`;
        if(alreadyRequested.length > 0){
            prompt += `Files already requested: ${alreadyRequested.join(', ')}\n`
        }

        if(this.scrumStory){
            prompt += `Scrum Story:\n`;
            prompt += `Title: ${this.scrumStory.title}\n`;
            prompt += `Plan:\n${this.scrumStory.plan.join('\n')}\n\n`;
        }

        prompt += '\n';
        prompt += `You should ONLY request for files that ACTUALLY EXIST in the project, listed above.\n\n`;

        prompt += `Your MUST respond using the following format, as an example:\n`;
        prompt += `["src/file1.ts", "src/file2.ts"]\n\n`;

        prompt += `DO NOT include JSON markdown blocks in your response (like \`\`\`json ... \`\`\`)\n\n`;

        return prompt;
    }

    private generateFileRequestPromptForPlanning(projectFiles: string[], alreadyRequested: string[]): string {
        let prompt = `Based on the user requirements and the project's file structure, which files do you need to examine to create a detailed Scrum story and implementation plan? Return a JSON array of file paths, relative to the project root. Example: ["src/file1.ts", "src/utils/helper.ts"]. If you have enough information, return "No more files".\n\n`;
        prompt += `Project Files:\n${projectFiles.join('\n')}\n\n`;
        if (alreadyRequested.length > 0) {
            prompt += `Files already requested: ${alreadyRequested.join(', ')}\n`;
        }

        if (this.requirements) {
            prompt += `User Requirements:\n${this.requirements.description}\n\n`;
            if (this.requirements.additionalDetails) {
                prompt += "Additional Details:\n";
                for (const [question, answer] of Object.entries(this.requirements.additionalDetails)) {
                    prompt += `Question: ${question}\nAnswer: ${answer}\n`;
                }
            }
        }

        prompt += '\n';
        prompt += `Your MUST respond using the following format, as an example:\n`;
        prompt += `["src/file1.ts", "src/file2.ts"]\n\n`;

        prompt += `DO NOT include JSON markdown blocks in your response (like \`\`\`json ... \`\`\`)\n\n`;

        return prompt;
    }

    private async getFileContentsMap(filePaths: string[], basePath: string): Promise<{ [filePath: string]: string }> {
        const contents: { [filePath: string]: string } = {};
        for (const filePath of filePaths) {
            try {
                const fullPath = path.join(basePath, filePath);
                const content = await fs.readFile(fullPath, 'utf-8');
                contents[filePath] = content;
            } catch (error: any) {
                this.logger.error(`Error reading file ${filePath}: ${error.message}`);
                contents[filePath] = `Error: Could not read file. ${error.message}`;
            }
        }
        return contents;
    }

    private async generateIterationDescription(files: { [key: string]: string }): Promise<string>{
        const prompt = `
            Based on the changes made in this iteration, please provide a brief description of the work done.
            ${JSON.stringify(files, null, 2)}
        `
        const response = await generateContent(prompt);
        return response ? response : "No description provided"
    }

    setProjectTitle(title: string) {
        if (this.requirements) {
            this.requirements.projectTitle = title;
        }
    }

    setProjectDescription(description: string) {
        if (this.requirements) {
            this.requirements.projectDescription = description;
        }
    }
}