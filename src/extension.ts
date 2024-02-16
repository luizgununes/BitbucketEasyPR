import CryptoUtil from "./crypto";
import * as vscode from "vscode";
import { window } from "vscode";

export function activate(context: vscode.ExtensionContext) {
  let createPullRequest = vscode.commands.registerCommand(
    "extension.createPullRequest",
    async () => {
      let username = vscode.workspace
        .getConfiguration()
        .get<string>(`easyPR.username`);
      let password = vscode.workspace
        .getConfiguration()
        .get<string>(`easyPR.password`);
      let workspaceName = vscode.workspace
        .getConfiguration()
        .get<string>(`easyPR.workspaceName`);
      let projectName = vscode.workspace
        .getConfiguration()
        .get<string>(`easyPR.projectName`);
      let openBrowser = vscode.workspace
        .getConfiguration()
        .get<boolean>(`easyPR.openBrowser`);

      if (!username?.includes("EasyPR:")) {
        if (username == "your-username") {
          window.showErrorMessage("You need to setup your username!");
          vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "easyPR"
          );
          return;
        } else {
          const encoded = "EasyPR:" + CryptoUtil.encrypt(username);
          vscode.workspace
            .getConfiguration()
            .update("easyPR.username", encoded, true);
          username = encoded;
        }
      }

      if (!password?.includes("EasyPR:")) {
        if (password == "your-password") {
          window.showErrorMessage("You need to setup your password!");
          vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "easyPR"
          );
          return;
        } else {
          const encoded = "EasyPR:" + CryptoUtil.encrypt(password);
          vscode.workspace
            .getConfiguration()
            .update("easyPR.password", encoded, true);
          password = encoded;
        }
      }

      if (!workspaceName?.includes("EasyPR:")) {
        if (workspaceName == "your-workspace-name") {
          window.showErrorMessage("You need to setup your workspace name!");
          vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "easyPR"
          );
          return;
        } else {
          const encoded = "EasyPR:" + CryptoUtil.encrypt(workspaceName);
          vscode.workspace
            .getConfiguration()
            .update("easyPR.workspaceName", encoded, true);
          workspaceName = encoded;
        }
      }

      if (!projectName?.includes("EasyPR:")) {
        if (projectName == "your-project-name") {
          window.showErrorMessage("You need to setup your project name!");
          vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "easyPR"
          );
          return;
        } else {
          const encoded = "EasyPR:" + CryptoUtil.encrypt(projectName);
          vscode.workspace
            .getConfiguration()
            .update("easyPR.projectName", encoded, true);
          projectName = encoded;
        }
      }

      username = CryptoUtil.decrypt(username?.split("EasyPR:")[1]);
      password = CryptoUtil.decrypt(password?.split("EasyPR:")[1]);
      workspaceName = CryptoUtil.decrypt(workspaceName?.split("EasyPR:")[1]);
      projectName = CryptoUtil.decrypt(projectName?.split("EasyPR:")[1]);

      let repositoriesArray: any = [];
      let branchesArray: any = [];

      const getOptions = {
        method: "GET",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(username + ":" + password).toString("base64"),
        },
      };

      await fetch(
        `https://api.bitbucket.org/2.0/repositories/${workspaceName}?q=project.key="${projectName}"&pagelen=100`,
        getOptions
      )
        .then(async (response) => {
          await response.json().then(async (repositories) => {
            await repositories.values.map(async (repository: any) => {
              await repositoriesArray.push(repository.slug);
            });
          });
        })
        .catch((error) => {
          window.showErrorMessage(error.message);
        });

      if (!repositoriesArray.length) {
        window.showWarningMessage("There are no source branches.");
        return;
      }

      let selectedRepository = await window.showQuickPick(repositoriesArray, {
        placeHolder: "Choose the repository:",
      });

      if (!selectedRepository) {
        window.showWarningMessage("You have to select a repository!");
        return;
      }

      if (selectedRepository) {
        await fetch(
          `https://api.bitbucket.org/2.0/repositories/${workspaceName}/${selectedRepository}/refs/branches?pagelen=100`,
          getOptions
        )
          .then(async (response) => {
            await response.json().then(async (branches) => {
              await branches.values.map(async (branch: any) => {
                await branchesArray.push(branch.name);
              });
            });
          })
          .catch((error) => {
            window.showErrorMessage(error.message);
          });
      }

      let selectedSourceBranch = await window.showQuickPick(branchesArray, {
        placeHolder: "Choose the source branch:",
      });

      if (!selectedSourceBranch) {
        window.showWarningMessage("You have to select a source branch!");
        return;
      }

      if (selectedSourceBranch) {
        branchesArray.splice(branchesArray.indexOf(selectedSourceBranch), 1);
      }

      if (!branchesArray.length) {
        window.showWarningMessage("There are no destination branches.");
        return;
      }

      let selectedDestinationBranch = await window.showQuickPick(
        branchesArray,
        {
          placeHolder: "Choose the destination branch:",
        }
      );

      if (!selectedDestinationBranch) {
        window.showWarningMessage("You have to select a destination branch!");
        return;
      }

      await fetch(
        `https://api.bitbucket.org/2.0/repositories/${workspaceName}/${selectedRepository}/pullrequests`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              "Basic " +
              Buffer.from(username + ":" + password).toString("base64"),
          },
          body: JSON.stringify({
            title: selectedSourceBranch + " to " + selectedDestinationBranch,
            source: {
              branch: {
                name: selectedSourceBranch,
              },
            },
            destination: {
              branch: {
                name: selectedDestinationBranch,
              },
            },
          }),
        }
      )
        .then(async (response) => {
          await response.json().then(async (pullRequest) => {
            window.showInformationMessage(`Pull Request opened!`);
            window.showInformationMessage(
              `Pull Request link copied to the clipboard!`
            );

            vscode.env.clipboard.writeText(
              `https://bitbucket.org/${workspaceName}/${selectedRepository}/pull-requests/${pullRequest.id}`
            );

            if (openBrowser) {
              vscode.env.openExternal(
                vscode.Uri.parse(
                  `https://bitbucket.org/${workspaceName}/${selectedRepository}/pull-requests/${pullRequest.id}`
                )
              );
            }

            return response;
          });
        })
        .catch((error) => {
          if (error.response.data.error.message) {
            if (
              error.response.data.error.message ==
              "There are no changes to be pulled."
            ) {
              window.showErrorMessage(
                "There are no changes on the source branch."
              );
            } else {
              window.showErrorMessage(error.response.data.error.message);
            }
          } else {
            window.showErrorMessage(error.message);
          }
        });
    }
  );

  context.subscriptions.push(createPullRequest);
}
