pipeline {
    agent any

    parameters {
        choice(
            name: 'DEPLOY_ENV',
            choices: ['development', 'production'],
            description: 'Target deployment environment'
        )
    }

    environment {
        DEV_SERVER = 'root@147.93.105.85'
        PROD_SERVER = 'root@31.97.239.167'
        DEV_PATH = '/var/www/festease_backend'
        PROD_PATH = '/var/www/festease_backend'
        SSH_CREDENTIALS_ID = 'server-ssh-key'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm install'
            }
        }

        stage('Deploy') {
            steps {
                script {
                    def targetServer = (params.DEPLOY_ENV == 'production') ? env.PROD_SERVER : env.DEV_SERVER
                    def targetPath = (params.DEPLOY_ENV == 'production') ? env.PROD_PATH : env.DEV_PATH

                    echo "Deploying festease_backend to ${params.DEPLOY_ENV} (${targetServer})..."

                    sshagent([env.SSH_CREDENTIALS_ID]) {
                        // Ensure directory exists on target server
                        sh "ssh -o StrictHostKeyChecking=no ${targetServer} 'mkdir -p ${targetPath}'"

                        // Sync codebase, excluding node_modules, .env, and logs
                        sh """
                            rsync -avz --delete \
                                --exclude='node_modules' \
                                --exclude='.env' \
                                --exclude='logs' \
                                --exclude='.git' \
                                -e 'ssh -o StrictHostKeyChecking=no' ./ ${targetServer}:${targetPath}/
                        """

                        // Remote execution: install dependencies, run migrations, reload PM2 service
                        sh """
                            ssh -o StrictHostKeyChecking=no ${targetServer} "cd ${targetPath} && npm install --omit=dev && (npm run migrate || true) && (pm2 reload saasbackend || pm2 start index.js --name saasbackend)"
                        """
                    }
                }
            }
        }
    }

    post {
        success {
            echo "Successfully deployed festease_backend to ${params.DEPLOY_ENV} environment."
        }
        failure {
            echo "Pipeline execution failed for festease_backend. Please check logs for details."
        }
    }
}
