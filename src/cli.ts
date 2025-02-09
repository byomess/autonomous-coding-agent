// src/cli.ts

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Agent } from './agent';
import { CommitOptions } from './types';
import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import fs from 'fs';  // Import the 'fs' module

export async function runCLI() {
    const argv = await yargs(hideBin(process.argv))
        .option('title', {
            alias: 't',
            type: 'string',
            description: 'Project title',
        })
        .option('description', {
            alias: 'd',
            type: 'string',
            description: 'Project description',
        })
        .option('requirements', {
            alias: 'r',
            type: 'string',
            description: 'Initial user requirements',
        })
        .option('repo', {
            alias: 'p',
            type: 'string',
            description: 'Path to existing repository',
        })
        .option('interactive', {
            alias: 'i',
            type: 'boolean',
            description: 'Run in interactive mode',
            default: false,
        })
        .option('no-questions', {
            alias: 'nq',
            type: 'boolean',
            description: 'Disable asking clarifying questions',
            default: true,
        })
        .help()
        .argv;

    const agent = new Agent();

    const interactiveMode = argv.interactive;
    const noQuestions = argv['no-questions']; // Get the value of no-questions

    let repoPath: string | undefined = argv.repo;
    let projectTitle: string | undefined = argv.title;
    let projectDescription: string | undefined = argv.description;
    let initialRequirements: string | undefined = argv.requirements;
    const rl = readline.createInterface({ input, output });

    if (interactiveMode) {
        console.log('Running in interactive mode.');

        const useExistingRepo = await rl.question('Use an existing repository? (y/n): ');
        if (useExistingRepo.toLowerCase() === 'y') {
            repoPath = await rl.question('Enter the repository path: ');
        }
        if (!projectTitle) {
            projectTitle = await rl.question("What is the title of this project? ");
        }
        if (!projectDescription) {
            projectDescription = await rl.question("Can you provide a brief description of the project? ");
        }

        if(!initialRequirements){
            initialRequirements = await rl.question('Describe what you would like the agent to develop: ');
        }
    } else {
        if (!argv.requirements) {
            console.error("Error:  --requirements (-r) is required in non-interactive mode.");
            process.exit(1);
        }
        repoPath = argv.repo;
        initialRequirements = argv.requirements;
        projectTitle = argv.title;
        projectDescription = argv.description
    }

     if (!initialRequirements) {
        console.error("Error: Initial requirements are required.");
        process.exit(1);
    }

    await agent.collectRequirements(initialRequirements, repoPath, noQuestions);

    if(projectTitle){
        agent.setProjectTitle(projectTitle)
    }
    if(projectDescription){
        agent.setProjectDescription(projectDescription)
    }

    console.log("Creating Scrum story...")
    const scrumStory = await agent.createActionPlan();
    console.log('Generated Scrum Story:', JSON.stringify(scrumStory, null, 2));

    fs.writeFileSync(`scrum-story-${Date.now()}.json`, JSON.stringify(scrumStory, null, 4));

    console.log("Starting development...")
    await agent.develop(scrumStory);

    const review = await rl.question('Review changes? (y/n): ');
    if (review.toLowerCase() === 'y') {
       let accepted: boolean;
        const keepChangesAnswer = await rl.question('Accept changes and commit? (y/n): ');
        if(keepChangesAnswer.toLowerCase() === "y"){
            accepted = true;
        } else {
            accepted = false;
        }
        let keep: boolean
        if(!accepted){
            const discardAnswer = await rl.question("Keep changes? (y/n): ")
            if(discardAnswer.toLowerCase() === "y"){
                keep = true
            } else {
                keep = false
            }
        } else {
            keep = true;
        }
        const options: CommitOptions = {
            accepted: accepted,
            keepChanges: keep,
        };
        await agent.reviewAndCommit(options);
    }

    rl.close();
}