// src/agent.ts
import { stdin as input, stdout as output } from 'process';
import * as fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import * as readline from 'readline/promises';

import { UserRequirements, ScrumStory, CommitOptions, TestResult } from './types';
import { generateContent } from './googleAI';
// import { createOrModifyProject, commitChanges } from './codeManager';
import { runTests, getProjectFiles } from './testRunner';
import * as prompts from './prompts';
import { GOOGLE_AI, TEST_COMMAND } from './constants';
import { extractJson } from './utils';
import { Logger } from './logger';
import simpleGit, { SimpleGit } from 'simple-git';

interface RequirementsCollector {
    collectRequirements(initialDescription: string, repoPath?: string, noQuestions?: boolean): Promise<UserRequirements>;
}

interface ActionPlanner {
    createActionPlan(requirements: UserRequirements, projectFiles: string[]): Promise<ScrumStory>;
}

interface CodeDeveloper {
    develop(scrumStory: ScrumStory, requirements: UserRequirements): Promise<void>;
    testRunnerService: TestRunnerService;
}

interface CodeManagerService {
    createOrModifyProject(basePath: string, files: { [key: string]: string }): Promise<void>;
    commitChanges(repoPath: string, options: CommitOptions): Promise<void>;
}

interface TestRunnerService {
    runTests(repoPath: string, testCommand: string): Promise<TestResult>;
    getProjectFiles(repoPath: string): Promise<string[]>;
}

interface PromptGenerator {
    clarifyRequirementsPrompt(requirements: UserRequirements | null): string;
    createScrumStoryPrompt(requirements: UserRequirements, fileContents: { [filePath: string]: string }): string;
    generateCodePromptFromScrumStory(scrumStory: ScrumStory, fileContents: { [filePath: string]: string }, iterationDescription: string, iterationNumber: number): string;
    generateFileRequestPrompt(projectFiles: string[], alreadyRequested: string[], currentFileContents: { [key: string]: string }, scrumStory?: ScrumStory): string;
    generateFileRequestPromptForPlanning(projectFiles: string[], alreadyRequested: string[], currentFileContents: { [key: string]: string }, requirements?: UserRequirements): string;
    generateIterationDescriptionPrompt(files: { [key: string]: string }): string;
}

interface FileSystemService {
    getFileContents(filePath: string): Promise<string>;
    getFileContentsMap(filePaths: string[], basePath: string): Promise<{ [filePath: string]: string }>;
}

interface UserInput {
    askQuestion(question: string): Promise<string>;
}

interface LLMContentGenerator {
    generateContent(prompt: string, systemMessage?: string): Promise<string | null>;
}

interface JSONParser {
    extractJson<T>(text: string): { success: boolean; data?: T; error?: any };
}

interface IterationDescriber {
    generateIterationDescription(files: { [key: string]: string }): Promise<string>;
}

class RequirementsCollectorImpl implements RequirementsCollector {
    private requirements: UserRequirements | null = null;
    private logger: Logger;
    private promptGenerator: PromptGenerator;
    private userInput: UserInput;
    private llmContentGenerator: LLMContentGenerator;

    constructor(logger: Logger, promptGenerator: PromptGenerator, userInput: UserInput, llmContentGenerator: LLMContentGenerator) {
        this.logger = logger;
        this.promptGenerator = promptGenerator;
        this.userInput = userInput;
        this.llmContentGenerator = llmContentGenerator;
    }

    async collectRequirements(
        initialDescription: string,
        repoPath?: string,
        noQuestions: boolean = false
    ): Promise<UserRequirements> {
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
            return this.requirements;
        }

        let continueAsking = true;
        while (continueAsking) {
            const prompt = this.promptGenerator.clarifyRequirementsPrompt(this.requirements);
            this.logger.debug(`Clarification prompt: ${prompt}`);

            const details = await this.llmContentGenerator.generateContent(prompt);
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

                    const answer = await this.userInput.askQuestion(question);
                    this.logger.debug(`User answer: ${answer}`);

                    this.requirements.additionalDetails[question] = answer;
                } else {
                    this.logger.warn(`Could not process details. Gemini responded: ${details}`);
                }
            }
        }
        this.logger.info(chalk.green(`Collected Requirements: ${JSON.stringify(this.requirements)}`));
        return this.requirements;
    }
}

class ActionPlannerImpl implements ActionPlanner {
    private logger: Logger;
    private promptGenerator: PromptGenerator;
    private llmContentGenerator: LLMContentGenerator;
    private jsonParser: JSONParser;
    private fileSystemService: FileSystemService;
    private planningFileContents: { [filePath: string]: string } = {};

    constructor(logger: Logger, promptGenerator: PromptGenerator, llmContentGenerator: LLMContentGenerator, jsonParser: JSONParser, fileSystemService: FileSystemService) {
        this.logger = logger;
        this.promptGenerator = promptGenerator;
        this.llmContentGenerator = llmContentGenerator;
        this.jsonParser = jsonParser;
        this.fileSystemService = fileSystemService;
    }

    async createActionPlan(requirements: UserRequirements, projectFiles: string[]): Promise<ScrumStory> {
        this.logger.debug("Entering createActionPlan");
        if (!requirements || !requirements.repositoryPath) {
            throw new Error('Requirements (including repository path) must be provided to create the action plan.');
        }

        this.logger.debug(`Project files: ${JSON.stringify(projectFiles)}`);

        let neededFiles: string[] = [];
        let continueGettingFiles = true;
        let iteration = 0;

        while (continueGettingFiles) {
            iteration++;
            const filePrompt = this.promptGenerator.generateFileRequestPromptForPlanning(projectFiles, neededFiles, this.planningFileContents, requirements);
            this.logger.debug(`File request prompt (planning) - iteration ${iteration}: ${filePrompt}`);

            const fileListResponse = await this.llmContentGenerator.generateContent(filePrompt);
            this.logger.debug(`Gemini response for file list (planning): ${fileListResponse}`);

            if (!fileListResponse) {
                throw new Error("Failed to get file list from Google Gemini.");
            }

            if (fileListResponse.toLowerCase().includes("no more files")) {
                continueGettingFiles = false;
            } else {
                const jsonResult = this.jsonParser.extractJson<string[]>(fileListResponse);
                if (jsonResult.success && Array.isArray(jsonResult.data)) {
                    neededFiles = [...new Set([...neededFiles, ...jsonResult.data])];
                    const newFileContents = await this.fileSystemService.getFileContentsMap(jsonResult.data, requirements.repositoryPath);
                    this.planningFileContents = { ...this.planningFileContents, ...newFileContents };
                    this.logger.debug(`Updated planning file contents: ${JSON.stringify(this.planningFileContents)}`);

                } else {
                    this.logger.warn(`Gemini did not return a valid array of files: ${fileListResponse}`);
                    if (jsonResult.error) {
                        this.logger.debug(`Extraction error: ${jsonResult.error}`);
                    }
                }
            }
        }
        this.logger.debug(`Files needed for planning: ${JSON.stringify(neededFiles)}`);
        this.logger.debug(`File contents retrieved (planning): ${JSON.stringify(this.planningFileContents)}`);


        const prompt = this.promptGenerator.createScrumStoryPrompt(requirements, this.planningFileContents);
        this.logger.debug(`Scrum story prompt: ${prompt}`);

        const storyText = await this.llmContentGenerator.generateContent(prompt, GOOGLE_AI.SYSTEM_MESSAGES.PLANNER);
        this.logger.debug(`Gemini response for Scrum story: ${storyText}`);

        if (!storyText) {
            throw new Error("Failed to create an action plan with Google Gemini.");
        }

        const jsonResult = this.jsonParser.extractJson<ScrumStory>(storyText);
        if (jsonResult.success) {
            const scrumStory = jsonResult.data;
            this.logger.debug(`Parsed Scrum story: ${JSON.stringify(scrumStory)}`);
            if (!scrumStory) {
                throw new Error("Failed to parse Scrum story from Gemini.");
            }
            return scrumStory;
        } else {
            this.logger.error(`Error parsing Scrum story JSON: ${storyText}`);
            this.logger.error(`Extraction error: ${jsonResult.error}`);
            throw new Error(`Failed to parse Scrum story from Gemini: ${jsonResult.error}`);
        }
    }
}


class CodeDeveloperImpl implements CodeDeveloper {
    private logger: Logger;
    private promptGenerator: PromptGenerator;
    private llmContentGenerator: LLMContentGenerator;
    private jsonParser: JSONParser;
    private fileSystemService: FileSystemService;
    private codeManagerService: CodeManagerService;
    private iterationDescriber: IterationDescriber;
    private currentIterationDescription: string = "";
    private currentFileContents: { [filePath: string]: string } = {};
    
    public testRunnerService: TestRunnerService;

    constructor(
        logger: Logger,
        promptGenerator: PromptGenerator,
        llmContentGenerator: LLMContentGenerator,
        jsonParser: JSONParser,
        fileSystemService: FileSystemService,
        codeManagerService: CodeManagerService,
        testRunnerService: TestRunnerService,
        iterationDescriber: IterationDescriber
    ) {
        this.logger = logger;
        this.promptGenerator = promptGenerator;
        this.llmContentGenerator = llmContentGenerator;
        this.jsonParser = jsonParser;
        this.fileSystemService = fileSystemService;
        this.codeManagerService = codeManagerService;
        this.testRunnerService = testRunnerService;
        this.iterationDescriber = iterationDescriber;
    }


    async develop(scrumStory: ScrumStory, requirements: UserRequirements): Promise<void> {
        this.logger.debug("Entering develop");

        if (!requirements || !requirements.repositoryPath) {
            throw new Error("Requirements (including repository path) not provided.")
        }

        let iterationCount = 0;
        const maxIterations = 3;

        const projectFiles = await this.testRunnerService.getProjectFiles(requirements.repositoryPath);
        this.logger.debug(`Project files: ${JSON.stringify(projectFiles)}`);

        this.currentFileContents = { ...this.currentFileContents };


        while (iterationCount < maxIterations) {
            iterationCount++;
            // console.log(chalk.blue(`Starting development iteration #${iterationCount}...`));
            this.logger.info(`Starting development iteration #${iterationCount}...`);
            this.currentIterationDescription = "";

            let neededFiles: string[] = [];
            let continueGettingFiles = true;

            const filesToRequest = projectFiles.filter(file =>
                !Object.keys(this.currentFileContents).includes(file)
            );

            if (filesToRequest.length > 0) {
                while (continueGettingFiles) {
                    const filePrompt = this.promptGenerator.generateFileRequestPrompt(projectFiles, neededFiles, this.currentFileContents, scrumStory);
                    this.logger.debug(`File request prompt: ${filePrompt}`);

                    const fileListResponse = await this.llmContentGenerator.generateContent(filePrompt);
                    this.logger.debug(`Gemini response for file list: ${fileListResponse}`);

                    if (!fileListResponse) {
                        throw new Error("Failed to get file list from Google Gemini.");
                    }

                    if (fileListResponse.toLowerCase().includes("no more files")) {
                        continueGettingFiles = false;
                    } else {
                        const jsonResult = this.jsonParser.extractJson<string[]>(fileListResponse);
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

            }
            this.logger.debug(`Files needed for this iteration: ${JSON.stringify(neededFiles)}`);

            const newFileContents = await this.fileSystemService.getFileContentsMap(neededFiles, requirements.repositoryPath);

            this.currentFileContents = { ...this.currentFileContents, ...newFileContents };
            this.logger.debug(`File contents retrieved: ${JSON.stringify(this.currentFileContents)}`);



            const codePrompt = this.promptGenerator.generateCodePromptFromScrumStory(scrumStory, this.currentFileContents, this.currentIterationDescription, iterationCount);
            this.logger.debug(`Code generation prompt: ${codePrompt}`);

            const codeResponse = await this.llmContentGenerator.generateContent(codePrompt);
            this.logger.debug(`Gemini response for code generation: ${codeResponse}`);

            if (!codeResponse) {
                throw new Error("Failed to generate code with Google Gemini.");
            }

            const jsonResult = this.jsonParser.extractJson<{ [key: string]: string }>(codeResponse);
            if (jsonResult.success) {
                const files = jsonResult.data;
                this.logger.debug(`Parsed files: ${JSON.stringify(files)}`);

                if (files) {
                    this.currentIterationDescription = await this.iterationDescriber.generateIterationDescription(files);
                    await this.codeManagerService.createOrModifyProject(requirements.repositoryPath, files);
                } else {
                    throw new Error("No files to create or modify.");
                }
                
                this.logger.debug(`Files created/modified in ${requirements.repositoryPath}: ${JSON.stringify(files)}`);
            } else {
                this.logger.error(`Gemini did not return valid JSON: ${codeResponse}`);
                this.logger.error(`Extraction error: ${jsonResult.error}`);
                continue;
            }

            // const testResult = await this.testRunnerService.runTests(requirements.repositoryPath, TEST_COMMAND); // Using constant here, consider config
            // console.log(testResult.passed ? chalk.green('Tests passed!') : chalk.red('Tests failed!'));
            // this.logger.debug(`Test results: ${JSON.stringify(testResult)}`);

            // if (testResult.passed) {
            //     break;
            // } else {
            //     requirements.additionalDetails['testErrors'] = testResult.details || 'Tests failed without details.';
            //     this.logger.error(`Tests failed. Details: ${testResult.details}`);
            // }

            break;
        }

        if (iterationCount === maxIterations) {
            this.logger.warn('Maximum number of iterations reached. There might be unresolved issues.');
        }
    }
}


class CodeManagerServiceImpl implements CodeManagerService {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    async createOrModifyProject(basePath: string, files: { [key: string]: string }): Promise<void> {
        const git: SimpleGit = simpleGit(basePath);

        try {
            const isRepo = await git.checkIsRepo();
            if (!isRepo) {
                await git.init();
            }
            for (const [filePath, content] of Object.entries(files)) {
                const fullPath = path.join(basePath, filePath);
                const dir = path.dirname(fullPath);
                await fs.mkdir(dir, { recursive: true });
                await fs.writeFile(fullPath, content, 'utf-8');
            }
        } catch (error: any) {
            throw new Error(`Error creating or modifying files: ${error.message}`);
        }
    }

    async commitChanges(repoPath: string, options: CommitOptions): Promise<void> {
        const git: SimpleGit = simpleGit(repoPath);

        if (options.accepted) {
            await git.add('./*');
            await git.commit('feat: Automatic changes by coding agent');
            this.logger.info('Changes committed successfully.');
        } else if (!options.keepChanges) {
            await git.reset(['--hard', 'HEAD']);
            this.logger.info('Changes discarded.');
        } else {
            this.logger.info("Changes not committed, but not discarded");
        }
    }
}

class TestRunnerServiceImpl implements TestRunnerService {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }
    async runTests(repoPath: string, testCommand: string): Promise<TestResult> {
        this.logger.debug("Entering runTests");
        return runTests(repoPath, testCommand); // Assuming original runTests function is already well implemented
    }

    async getProjectFiles(repoPath: string): Promise<string[]> {
        this.logger.debug("Entering getProjectFiles");
        return getProjectFiles(repoPath); // Assuming original getProjectFiles function is already well implemented
    }
}

class PromptGeneratorImpl implements PromptGenerator {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }
    clarifyRequirementsPrompt(requirements: UserRequirements | null): string {
        if (!requirements) {
            throw new Error("Requirements cannot be null");
        }
        return prompts.clarifyRequirementsPrompt(requirements);
    }
    createScrumStoryPrompt(requirements: UserRequirements, fileContents: { [filePath: string]: string }): string {
        return prompts.createScrumStoryPrompt(requirements, fileContents);
    }
    generateCodePromptFromScrumStory(scrumStory: ScrumStory, fileContents: { [filePath: string]: string }, iterationDescription: string, iterationNumber: number): string {
        let prompt = '\n';
        prompt += `Implement all the code for this Scrum story.\n`;
        // prompt += `Use Test-Driven Development (TDD), meaning you should generaet all the tests first. Then, implement the code to pass the tests.\n`;
        prompt += `\n`;
        prompt += `Iteration #${iterationNumber}\n`;
        prompt += `\n\n`;
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

        if (iterationDescription) {
            prompt += `\n\nPrevious Iteration Description:\n${iterationDescription}`;
        }
        prompt += '\n\n';
        prompt += `Your MUST respond using the following format, as an example:\n`;
        prompt += `{\n  "src/file1.ts": "export class MyClass { ... }",\n "src/file2.ts": "export function myFunction() { ... }"\n}\n\n`;

        return prompt;
    }
    generateFileRequestPrompt(projectFiles: string[], alreadyRequested: string[], currentFileContents: { [key: string]: string }, scrumStory?: ScrumStory): string {
        let prompt = `Based on the Scrum story and the project's file structure, which files do you need to examine to implement the next step?\n\n`;
        prompt += `Project Files:\n${projectFiles.join('\n')}\n\n`;

        if(alreadyRequested.length > 0){
            prompt += `Files already requested: ${alreadyRequested.join(', ')}\n`
        }

        if (Object.keys(currentFileContents).length > 0) {
            prompt += `\nCurrent Relevant File Contents:\n`;
            for (const [filePath, content] of Object.entries(currentFileContents)) {
                prompt += `\n--- ${filePath} ---\n${content}\n`;
            }
        }

        if(scrumStory){
            prompt += `Scrum Story:\n`;
            prompt += `Title: ${scrumStory.title}\n`;
            prompt += `Plan:\n${scrumStory.plan.join('\n')}\n\n`;
        }

        prompt += '\n\n';
        prompt += `You should ONLY request for files that ACTUALLY EXIST in the project, listed above.\n\n`;
        prompt += `DO NOT request for file contents that are ALREADY provided above, in the "Current Relevant File Contents" section.\n\n`;
        prompt += `You MUST respond using the following format, as an example:\n`;
        prompt += `["src/file1.ts", "src/utils/helper.ts"]\n\n`;
        prompt += `If you have enough file contents context for the next step, return "No more files".`;

        return prompt;
    }
    generateFileRequestPromptForPlanning(projectFiles: string[], alreadyRequested: string[], currentFileContents: { [key: string]: string }, requirements?: UserRequirements): string {
        let prompt = `Based on the user requirements and the project's file structure, which files do you need to examine to create a detailed Scrum story and implementation plan? Focus on files that contain functional logic and existing code, rather than configuration files. Return a JSON array of file paths, relative to the project root. Example: ["src/file1.ts", "src/utils/helper.ts"]. If you have enough information, return "No more files".\n\n`;
        prompt += `Project Files:\n${projectFiles.join('\n')}\n\n`;

        if (alreadyRequested.length > 0) {
            prompt += `Files already requested: ${alreadyRequested.join(', ')}\n`;
        }

        if (Object.keys(currentFileContents).length > 0) {
            prompt += `\nCurrent Relevant File Contents:\n`;
            for (const [filePath, content] of Object.entries(currentFileContents)) {
                prompt += `\n--- ${filePath} ---\n${content}\n`;
            }
        }

        if (requirements) {
            prompt += `User Requirements:\n${requirements.description}\n\n`;
            if (requirements.additionalDetails) {
                prompt += "Additional Details:\n";
                for (const [question, answer] of Object.entries(requirements.additionalDetails)) {
                    prompt += `Question: ${question}\nAnswer: ${answer}\n`;
                }
            }
        }
        prompt += '\n';
        return prompt;
    }

    generateIterationDescriptionPrompt(files: { [key: string]: string }): string {
        return `
            Based on the changes made in this iteration, please provide a brief description of the work done.
            ${JSON.stringify(files, null, 2)}
        `;
    }
}

class FileSystemServiceImpl implements FileSystemService {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    async getFileContents(filePath: string): Promise<string> {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return content;
        } catch (error: any) {
            this.logger.error(`Error reading file ${filePath}: ${error.message}`);
            return `Error: Could not read file. ${error.message}`;
        }
    }

    async getFileContentsMap(filePaths: string[], basePath: string): Promise<{ [filePath: string]: string }> {
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
}

class UserInputImpl implements UserInput {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }
    async askQuestion(question: string): Promise<string> {
        const rl = readline.createInterface({ input, output });
        const answer = await rl.question(chalk.yellow(question) + " ");
        rl.close();
        return answer;
    }
}

class LLMContentGeneratorImpl implements LLMContentGenerator {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }
    async generateContent(prompt: string, systemMessage?: string | undefined): Promise<string | null> {
        this.logger.debug("Generating content with prompt:\n" + prompt); // Consider truncating for very long prompts in debug logs
        return generateContent(prompt, systemMessage);
    }
}

class JSONParserImpl implements JSONParser {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }
    extractJson<T>(text: string): { success: boolean; data?: T | undefined; error?: any } {
        return extractJson(text);
    }
}

class IterationDescriberImpl implements IterationDescriber {
    private logger: Logger;
    private promptGenerator: PromptGenerator;
    private llmContentGenerator: LLMContentGenerator;

    constructor(logger: Logger, promptGenerator: PromptGenerator, llmContentGenerator: LLMContentGenerator) {
        this.logger = logger;
        this.promptGenerator = promptGenerator;
        this.llmContentGenerator = llmContentGenerator;
    }

    async generateIterationDescription(files: { [key: string]: string }): Promise<string> {
        const prompt = this.promptGenerator.generateIterationDescriptionPrompt(files);
        const response = await this.llmContentGenerator.generateContent(prompt);
        return response ? response : "No description provided";
    }
}


export class Agent {
    private requirements: UserRequirements | null = null;
    private scrumStory: ScrumStory | null = null;
    private logger: Logger;
    private requirementsCollector: RequirementsCollector;
    private actionPlanner: ActionPlanner;
    private codeDeveloper: CodeDeveloper;
    private codeManagerService: CodeManagerService;


    constructor() {
        this.logger = new Logger();
        const promptGenerator = new PromptGeneratorImpl(this.logger);
        const userInput = new UserInputImpl(this.logger);
        const llmContentGenerator = new LLMContentGeneratorImpl(this.logger);
        const jsonParser = new JSONParserImpl(this.logger);
        const fileSystemService = new FileSystemServiceImpl(this.logger);
        const testRunnerService = new TestRunnerServiceImpl(this.logger);
        const codeManagerService = new CodeManagerServiceImpl(this.logger);
        const iterationDescriber = new IterationDescriberImpl(this.logger, promptGenerator, llmContentGenerator);

        this.requirementsCollector = new RequirementsCollectorImpl(this.logger, promptGenerator, userInput, llmContentGenerator);
        this.actionPlanner = new ActionPlannerImpl(this.logger, promptGenerator, llmContentGenerator, jsonParser, fileSystemService);
        this.codeDeveloper = new CodeDeveloperImpl(
            this.logger, promptGenerator, llmContentGenerator, jsonParser,
            fileSystemService, codeManagerService, testRunnerService, iterationDescriber
        );
        this.codeManagerService = codeManagerService;
    }

    async collectRequirements(
        initialDescription: string,
        repoPath?: string,
        noQuestions: boolean = false
    ): Promise<void> {
        this.requirements = await this.requirementsCollector.collectRequirements(initialDescription, repoPath, noQuestions);
    }

    async createActionPlan(): Promise<ScrumStory> {
        if (!this.requirements || !this.requirements.repositoryPath) {
            throw new Error('Requirements (including repository path) must be collected before creating the action plan.');
        }
        const projectFiles = await this.codeDeveloper.testRunnerService.getProjectFiles(this.requirements.repositoryPath); // Using codeDeveloper's testRunnerService to get files
        this.scrumStory = await this.actionPlanner.createActionPlan(this.requirements, projectFiles);
        return this.scrumStory;
    }

    async develop(): Promise<void> {
        if (!this.scrumStory || !this.requirements) {
            throw new Error("Scrum story and requirements must be available to start development.");
        }
        await this.codeDeveloper.develop(this.scrumStory, this.requirements);
    }


    async reviewAndCommit(options: CommitOptions): Promise<void> {
        this.logger.debug("Entering reviewAndCommit");
        if (!this.requirements?.repositoryPath) {
            this.logger.warn("Not a repository. Cannot commit.");
            return;
        }
        await this.codeManagerService.commitChanges(this.requirements.repositoryPath, options);
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