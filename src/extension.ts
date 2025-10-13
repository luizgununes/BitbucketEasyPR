import * as vscode from "vscode";
import { window } from "vscode";

const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  timeout: 30000,
};

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number = RETRY_CONFIG.timeout
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error(
        "Request timeout. Please check your internet connection and try again."
      );
    }
    throw error;
  }
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      if (
        error.message.includes("401") ||
        error.message.includes("403") ||
        error.message.includes("404")
      ) {
        throw error;
      }

      if (attempt === RETRY_CONFIG.maxRetries - 1) {
        throw new Error(
          `${operationName} failed after ${RETRY_CONFIG.maxRetries} attempts: ${error.message}`
        );
      }

      const delay = Math.min(
        RETRY_CONFIG.initialDelay * Math.pow(2, attempt),
        RETRY_CONFIG.maxDelay
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

function validateName(
  name: string,
  type: "workspace" | "project"
): { valid: boolean; error?: string } {
  if (!name || name.trim() === "") {
    return { valid: false, error: `${type} name cannot be empty.` };
  }

  if (name.length < 2) {
    return {
      valid: false,
      error: `${type} name must be at least 2 characters long.`,
    };
  }

  if (name.length > 100) {
    return {
      valid: false,
      error: `${type} name cannot exceed 100 characters.`,
    };
  }

  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(name)) {
    return {
      valid: false,
      error: `${type} name can only contain letters, numbers, hyphens, and underscores.`,
    };
  }

  return { valid: true };
}

interface BitbucketRepository {
  slug: string;
  name: string;
}

interface BitbucketBranch {
  name: string;
  type: string;
}

interface BitbucketRepositoriesResponse {
  values: BitbucketRepository[];
  size: number;
}

interface BitbucketBranchesResponse {
  values: BitbucketBranch[];
  size: number;
}

function createApiTokenAuthHeader(email: string, token: string): string {
  const credentials = Buffer.from(`${email}:${token}`).toString("base64");
  return `Basic ${credentials}`;
}

async function fetchRepositories(
  workspaceName: string,
  projectName: string,
  authHeader: string
): Promise<string[]> {
  return retryWithBackoff(async () => {
    const response = await fetchWithTimeout(
      `https://api.bitbucket.org/2.0/repositories/${workspaceName}?q=project.key="${projectName}"&pagelen=100`,
      {
        method: "GET",
        headers: {
          Authorization: authHeader,
        },
      }
    );

    if (response.status === 401) {
      throw new Error(
        "Authentication failed (401). Your API token is invalid or expired. Please create a new API token at: https://bitbucket.org/account/settings/app-passwords/ with 'Repositories: Read' and 'Pull requests: Write' permissions."
      );
    }

    if (response.status === 403) {
      throw new Error(
        "Access denied (403). Please verify you have permission to access this workspace and that your API token has 'repository:read' scope."
      );
    }

    if (response.status === 404) {
      throw new Error(
        `Workspace '${workspaceName}' or project '${projectName}' not found (404). Please verify the names are correct.`
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch repositories (HTTP ${response.status}): ${response.statusText}. Details: ${errorText}`
      );
    }

    const repositories: BitbucketRepositoriesResponse = await response.json();

    if (!repositories.values || repositories.values.length === 0) {
      throw new Error(
        `No repositories found for project '${projectName}' in workspace '${workspaceName}'.`
      );
    }

    const repositoryList: string[] = [];
    repositories.values.forEach((repository: BitbucketRepository) => {
      repositoryList.push(repository.slug);
    });

    return repositoryList;
  }, "Fetch repositories");
}

async function fetchBranches(
  workspaceName: string,
  repository: string,
  authHeader: string
): Promise<string[]> {
  return retryWithBackoff(async () => {
    const response = await fetchWithTimeout(
      `https://api.bitbucket.org/2.0/repositories/${workspaceName}/${repository}/refs/branches?pagelen=100`,
      {
        method: "GET",
        headers: {
          Authorization: authHeader,
        },
      }
    );

    if (response.status === 401) {
      throw new Error(
        "Authentication failed. Please check your API token in 'Reconfigure Credentials' command."
      );
    }

    if (response.status === 403) {
      throw new Error(
        "Access denied. Please verify you have permission to access this repository and that your API token has 'repository:read' scope."
      );
    }

    if (response.status === 404) {
      throw new Error(
        `Repository '${repository}' not found in workspace '${workspaceName}'.`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch branches (HTTP ${response.status}): ${response.statusText}`
      );
    }

    const branches: BitbucketBranchesResponse = await response.json();

    if (!branches.values || branches.values.length === 0) {
      throw new Error(
        `No branches found in repository '${repository}'. Please create at least one branch first.`
      );
    }

    const branchList: string[] = [];
    branches.values.forEach((branch: BitbucketBranch) => {
      branchList.push(branch.name);
    });

    return branchList;
  }, "Fetch branches");
}

async function createPullRequestAPI(
  workspaceName: string,
  repository: string,
  sourceBranch: string,
  destinationBranch: string,
  authHeader: string
): Promise<{ id: number; url: string }> {
  return retryWithBackoff(async () => {
    const response = await fetchWithTimeout(
      `https://api.bitbucket.org/2.0/repositories/${workspaceName}/${repository}/pullrequests`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          title: sourceBranch + " to " + destinationBranch,
          source: {
            branch: {
              name: sourceBranch,
            },
          },
          destination: {
            branch: {
              name: destinationBranch,
            },
          },
        }),
      }
    );

    if (response.status === 401) {
      throw new Error(
        "Authentication failed. Please check your API token in 'Reconfigure Credentials' command."
      );
    }

    if (response.status === 403) {
      throw new Error(
        "Access denied. Please verify you have permission to create pull requests and that your API token has 'pullrequest:write' scope."
      );
    }

    if (response.status === 404) {
      throw new Error(
        `Repository '${repository}' not found or one of the branches doesn't exist.`
      );
    }

    if (!response.ok) {
      const errorData = await response.json();
      if (errorData.error?.message) {
        if (errorData.error.message === "There are no changes to be pulled.") {
          throw new Error(
            `No changes to pull. The branch '${sourceBranch}' has the same commits as '${destinationBranch}'.`
          );
        } else if (errorData.error.message.includes("already exists")) {
          throw new Error(
            `A pull request from '${sourceBranch}' to '${destinationBranch}' already exists.`
          );
        } else {
          throw new Error(
            `Failed to create pull request: ${errorData.error.message}`
          );
        }
      }
      throw new Error(
        `Failed to create pull request (HTTP ${response.status}): ${response.statusText}`
      );
    }

    const pullRequest = await response.json();

    if (!pullRequest.id) {
      throw new Error(
        "Pull Request created but ID is missing from response. Please check Bitbucket manually."
      );
    }

    return {
      id: pullRequest.id,
      url: `https://bitbucket.org/${workspaceName}/${repository}/pull-requests/${pullRequest.id}`,
    };
  }, "Create pull request");
}

async function getSecureValue(
  context: vscode.ExtensionContext,
  key: string,
  displayName: string
): Promise<string | undefined> {
  let value = await context.secrets.get(key);

  if (!value) {
    const oldValue = vscode.workspace.getConfiguration().get<string>(key);

    if (oldValue && oldValue !== `your-${key.split(".")[1]}`) {
      if (oldValue.includes("EasyPR:")) {
        window.showWarningMessage(
          `Please re-enter your ${displayName}. The extension now uses more secure storage.`
        );
        await vscode.workspace.getConfiguration().update(key, undefined, true);
      } else {
        await context.secrets.store(key, oldValue);
        await vscode.workspace.getConfiguration().update(key, undefined, true);
        value = oldValue;
      }
    }
  }

  return value;
}

async function promptAndStoreValue(
  context: vscode.ExtensionContext,
  key: string,
  prompt: string,
  password: boolean = false,
  validateType?: "workspace" | "project"
): Promise<string | undefined> {
  let isValid = false;
  let value: string | undefined;

  while (!isValid) {
    value = await window.showInputBox({
      prompt,
      password,
      ignoreFocusOut: true,
      validateInput: validateType
        ? (input: string) => {
            const validation = validateName(input, validateType);
            return validation.valid ? null : validation.error;
          }
        : undefined,
    });

    if (!value) {
      return undefined;
    }

    if (validateType) {
      const validation = validateName(value, validateType);
      if (!validation.valid) {
        window.showErrorMessage(validation.error || "Invalid input");
        continue;
      }
    }

    isValid = true;
  }

  if (value) {
    await context.secrets.store(key, value);
  }

  return value;
}

export function activate(context: vscode.ExtensionContext) {
  const createPullRequest = vscode.commands.registerCommand(
    "extension.createPullRequest",
    async () => {
      const oldUsername = await context.secrets.get("easyPR.username");
      const oldPassword = await context.secrets.get("easyPR.password");

      if (
        (oldUsername || oldPassword) &&
        !(await context.secrets.get("easyPR.apiToken"))
      ) {
        const migrate = await window.showWarningMessage(
          "⚠️ Bitbucket has replaced App passwords with API tokens as of September 2025. You need to create an API token to continue using this extension.",
          "Create API Token",
          "Learn More",
          "Dismiss"
        );

        if (migrate === "Learn More") {
          vscode.env.openExternal(
            vscode.Uri.parse(
              "https://support.atlassian.com/bitbucket-cloud/docs/api-tokens/"
            )
          );
          return;
        } else if (migrate === "Create API Token") {
          vscode.env.openExternal(
            vscode.Uri.parse(
              "https://bitbucket.org/account/settings/app-passwords/"
            )
          );
          return;
        } else {
          return;
        }
      }

      let email: string | undefined = await getSecureValue(
        context,
        "easyPR.email",
        "Atlassian account email"
      );
      let apiToken: string | undefined = await getSecureValue(
        context,
        "easyPR.apiToken",
        "API token"
      );
      let workspaceName: string | undefined = await getSecureValue(
        context,
        "easyPR.workspaceName",
        "workspace name"
      );
      let projectName: string | undefined = await getSecureValue(
        context,
        "easyPR.projectName",
        "project name"
      );

      const openBrowser = vscode.workspace
        .getConfiguration()
        .get<boolean>("easyPR.openBrowser");

      if (!email) {
        email = await promptAndStoreValue(
          context,
          "easyPR.email",
          "Enter your Atlassian account email (found in Bitbucket Settings > Personal settings):"
        );
        if (!email) {
          window.showErrorMessage("Atlassian account email is required!");
          return;
        }
      }

      if (!apiToken) {
        const learnMore = await window.showInformationMessage(
          "Bitbucket API token is required. API tokens have replaced App passwords as of September 2025.",
          "Learn More",
          "Continue"
        );

        if (learnMore === "Learn More") {
          vscode.env.openExternal(
            vscode.Uri.parse(
              "https://support.atlassian.com/bitbucket-cloud/docs/api-tokens/"
            )
          );
        }

        apiToken = await promptAndStoreValue(
          context,
          "easyPR.apiToken",
          "Enter your Bitbucket API token (with Repositories: Read/Write and Pull requests: Write scopes):",
          true
        );
        if (!apiToken) {
          window.showErrorMessage("API token is required!");
          return;
        }
      }

      if (!workspaceName) {
        workspaceName = await promptAndStoreValue(
          context,
          "easyPR.workspaceName",
          "Enter your Bitbucket workspace name:",
          false,
          "workspace"
        );
        if (!workspaceName) {
          window.showInformationMessage("Operation cancelled.");
          return;
        }
      }

      if (!projectName) {
        projectName = await promptAndStoreValue(
          context,
          "easyPR.projectName",
          "Enter your Bitbucket project name:",
          false,
          "project"
        );
        if (!projectName) {
          window.showInformationMessage("Operation cancelled.");
          return;
        }
      }

      const authHeader = createApiTokenAuthHeader(email, apiToken);

      let repositoriesArray: string[];
      try {
        repositoriesArray = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Bitbucket EasyPR",
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: "Fetching repositories..." });
            return await fetchRepositories(
              workspaceName,
              projectName,
              authHeader
            );
          }
        );
      } catch (error: any) {
        window.showErrorMessage(error.message);
        return;
      }

      if (!repositoriesArray.length) {
        window.showWarningMessage("No repositories found for this project.");
        return;
      }

      const selectedRepository = await window.showQuickPick(repositoriesArray, {
        placeHolder: "Choose the repository:",
      });

      if (!selectedRepository) {
        window.showInformationMessage("Operation cancelled.");
        return;
      }

      let branchesArray: string[];
      try {
        branchesArray = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Bitbucket EasyPR",
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: "Fetching branches..." });
            return await fetchBranches(
              workspaceName,
              selectedRepository,
              authHeader
            );
          }
        );
      } catch (error: any) {
        window.showErrorMessage(error.message);
        return;
      }

      const selectedSourceBranch = await window.showQuickPick(branchesArray, {
        placeHolder: "Choose the source branch:",
      });

      if (!selectedSourceBranch) {
        window.showInformationMessage("Operation cancelled.");
        return;
      }

      branchesArray.splice(branchesArray.indexOf(selectedSourceBranch), 1);

      if (!branchesArray.length) {
        window.showWarningMessage("There are no destination branches.");
        return;
      }

      const selectedDestinationBranch = await window.showQuickPick(
        branchesArray,
        {
          placeHolder: "Choose the destination branch:",
        }
      );

      if (!selectedDestinationBranch) {
        window.showInformationMessage("Operation cancelled.");
        return;
      }

      try {
        const prResult = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Bitbucket EasyPR",
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: "Creating Pull Request..." });
            return await createPullRequestAPI(
              workspaceName,
              selectedRepository,
              selectedSourceBranch,
              selectedDestinationBranch,
              authHeader
            );
          }
        );

        window.showInformationMessage("Pull Request opened!");
        window.showInformationMessage(
          "Pull Request link copied to the clipboard!"
        );

        vscode.env.clipboard.writeText(prResult.url);

        if (openBrowser) {
          vscode.env.openExternal(vscode.Uri.parse(prResult.url));
        }
      } catch (error: any) {
        window.showErrorMessage(
          `Failed to create Pull Request: ${error.message}`
        );
      }
    }
  );

  const clearCredentials = vscode.commands.registerCommand(
    "extension.clearCredentials",
    async () => {
      const confirm = await window.showWarningMessage(
        "Are you sure you want to clear all stored credentials?",
        { modal: true },
        "Yes",
        "No"
      );

      if (confirm === "Yes") {
        await context.secrets.delete("easyPR.username");
        await context.secrets.delete("easyPR.password");
        await context.secrets.delete("easyPR.email");
        await context.secrets.delete("easyPR.apiToken");
        await context.secrets.delete("easyPR.workspaceName");
        await context.secrets.delete("easyPR.projectName");

        window.showInformationMessage("All credentials have been cleared.");
      }
    }
  );

  const reconfigureCredentials = vscode.commands.registerCommand(
    "extension.reconfigureCredentials",
    async () => {
      const credentialOptions = [
        {
          label: "Atlassian Email",
          key: "easyPR.email",
          prompt: "Enter your Atlassian account email:",
          password: false,
        },
        {
          label: "API Token",
          key: "easyPR.apiToken",
          prompt:
            "Enter your Bitbucket API token (with Repositories: Read/Write and Pull requests: Write scopes):",
          password: true,
        },
        {
          label: "Workspace",
          key: "easyPR.workspaceName",
          prompt: "Enter your Bitbucket workspace name:",
          password: false,
          validate: "workspace" as const,
        },
        {
          label: "Project",
          key: "easyPR.projectName",
          prompt: "Enter your Bitbucket project name:",
          password: false,
          validate: "project" as const,
        },
        { label: "Clear All", key: "all", prompt: "", password: false },
      ];

      const selected = await window.showQuickPick(
        credentialOptions.map((opt) => opt.label),
        {
          placeHolder: "Select which credential to reconfigure:",
        }
      );

      if (!selected) {
        window.showInformationMessage("Operation cancelled.");
        return;
      }

      const selectedOption = credentialOptions.find(
        (opt) => opt.label === selected
      );

      if (!selectedOption) {
        return;
      }

      if (selectedOption.key === "all") {
        const confirm = await window.showWarningMessage(
          "Are you sure you want to clear all stored credentials?",
          { modal: true },
          "Yes",
          "No"
        );

        if (confirm === "Yes") {
          await context.secrets.delete("easyPR.username");
          await context.secrets.delete("easyPR.password");
          await context.secrets.delete("easyPR.email");
          await context.secrets.delete("easyPR.apiToken");
          await context.secrets.delete("easyPR.workspaceName");
          await context.secrets.delete("easyPR.projectName");

          window.showInformationMessage("All credentials have been cleared.");
        }
      } else {
        await context.secrets.delete(selectedOption.key);

        const newValue = await promptAndStoreValue(
          context,
          selectedOption.key,
          selectedOption.prompt,
          selectedOption.password,
          selectedOption.validate
        );

        if (newValue) {
          window.showInformationMessage(
            `${selectedOption.label} has been updated.`
          );
        } else {
          window.showInformationMessage("Operation cancelled.");
        }
      }
    }
  );

  context.subscriptions.push(
    createPullRequest,
    clearCredentials,
    reconfigureCredentials
  );
}
