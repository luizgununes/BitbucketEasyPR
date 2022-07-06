'use strict';
import * as vscode from 'vscode';
import axios from 'axios';
import { window } from 'vscode';

export function activate(context: vscode.ExtensionContext) {

    let createPullRequest = vscode.commands.registerCommand('extension.createPullRequest', async () => {
        let username = vscode.workspace.getConfiguration(undefined).get<string>(`easyPR.username`);
        let password = vscode.workspace.getConfiguration(undefined).get<string>(`easyPR.password`);
        let workspaceName = vscode.workspace.getConfiguration(undefined).get<string>(`easyPR.workspaceName`);
        let projectName = vscode.workspace.getConfiguration(undefined).get<string>(`easyPR.projectName`);

        if (username == 'your-username') {
            window.showErrorMessage('You need to setup your username!');
            vscode.commands.executeCommand('workbench.action.openSettings', 'easyPR');
        } else if (password == 'your-password') {
            window.showErrorMessage('You need to setup your password!');
            vscode.commands.executeCommand('workbench.action.openSettings', 'easyPR');
        } else if (workspaceName == 'your-workspace-name') {
            window.showErrorMessage('You need to setup your workspace name!');
            vscode.commands.executeCommand('workbench.action.openSettings', 'easyPR');
        } else if (projectName == 'your-project-name') {
            window.showErrorMessage('You need to setup your project name!');
            vscode.commands.executeCommand('workbench.action.openSettings', 'easyPR');
        } else {
            const {data:{values:repositories}} = await axios.get(`https://api.bitbucket.org/2.0/repositories/${workspaceName}?q=project.key="${projectName}"&pagelen=100`, {
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(username + ":" + password).toString('base64')
                }
            });
    
            let repositoriesName = [];
    
            repositoriesName = repositories.map((x: any) => {
                return x.slug;
            });
    
            const selectedRepository = await window.showQuickPick(repositoriesName, {
                placeHolder: 'Choose the repository:',
            });
    
            const {data:{values:branches}} = await axios.get(`https://api.bitbucket.org/2.0/repositories/${workspaceName}/${selectedRepository}/refs/branches?pagelen=100`, {
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(username + ":" + password).toString('base64')
                }
            });
    
            let branchesList = [];
    
            branchesList = branches.map((x: any) => {
                return x.name;
            })
    
            let selectedSourceBranch = await window.showQuickPick(branchesList, {
                placeHolder: 'Choose the source branch:',
            });
    
            let index = branchesList.indexOf(selectedSourceBranch);
            branchesList.splice(index, 1);
    
            let selectedDestinationBranch = await window.showQuickPick(branchesList, {
                placeHolder: 'Choose the destination branch:',
            });
    
            var url = `https://api.bitbucket.org/2.0/repositories/${workspaceName}/${selectedRepository}/pullrequests`
    
            let body = {
                "title": selectedSourceBranch + ' to ' + selectedDestinationBranch,
                "source": {
                    "branch": {
                        "name": selectedSourceBranch
                    }
                },
                "destination": {
                    "branch": {
                        "name": selectedDestinationBranch
                    }
                }
            }
    
            try {
                const response = await axios.post(url, body, {
                    headers: {
                        'Authorization': 'Basic ' + Buffer.from(username + ":" + password).toString('base64')
                    },
                });
    
                window.showInformationMessage(`Pull Request opened!`);
                window.showInformationMessage(`Pull Request link copied to the clipboard!`);
    
                vscode.env.clipboard.writeText(`https://bitbucket.org/${workspaceName}/amplifiqueme_front/pull-requests/${response.data.id}`);
    
                return response;
            } catch (error) {
                // @ts-ignore
                if (error.response.data.error.message) {
                    // @ts-ignore
                    if (error.response.data.error.message == 'There are no changes to be pulled') {
                        window.showErrorMessage('There are no changes on the source branch!');
                    } else {
                        // @ts-ignore
                        window.showErrorMessage(error.response.data.error.message);
                    }
                } else {
                    // @ts-ignore
                    window.showErrorMessage(error.message);
                }
            }
        }
    });
    
    context.subscriptions.push(createPullRequest);
}