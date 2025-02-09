export interface UserRequirements {
  description: string;
  repositoryPath?: string;
  additionalDetails: { [key: string]: string };
  projectTitle?: string; // Add project title
  projectDescription?: string; // Add project description
}

export interface ScrumStory {
  title: string;
  shortDescription: string;
  longDescription: string;
  acceptanceCriteria: string[];
  plan: string[]; // Step-by-step actions
  // Add other useful fields as needed
  estimatedHours?: number;
  dependencies?: string[];
  risks?: string[];
  notes?: string;
}

export interface ActionPlan { // Keep this for compatibility with existing code
  steps: string[];
}

export interface TestResult {
  passed: boolean;
  details?: string;
}

export interface CommitOptions{
    accepted: boolean;
    keepChanges: boolean;
}