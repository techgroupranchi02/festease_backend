pipeline {
    agent any

    options {
        disableConcurrentBuilds()
    }

    triggers {
        githubPush()
    }

    environment {
        DEV_SERVER          = 'root@147.93.105.85'
        PROD_SERVER         = 'root@31.97.239.167'
        DEPLOY_PATH         = '/var/www/festease_backend'
        SSH_CREDS           = 'server-ssh-key'
        PM2_APP_NAME        = 'saasbackend'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Determine Environment') {
            steps {
                script {
                    def branch = env.BRANCH_NAME ?: (env.GIT_BRANCH ? env.GIT_BRANCH.replaceFirst('^origin/', '').replaceFirst('^refs/heads/', '') : 'development')
                    def isProduction = (branch == 'main' || branch == 'master')
                    env.DEPLOY_ENV = isProduction ? 'production' : 'development'
                    env.TARGET_SERVER = isProduction ? env.PROD_SERVER : env.DEV_SERVER

                    echo "=========================================="
                    echo " Branch Detected : ${branch}"
                    echo " Target Env      : ${env.DEPLOY_ENV}"
                    echo " Target Server   : ${env.TARGET_SERVER}"
                    echo " PM2 App Name    : ${env.PM2_APP_NAME}"
                    echo "=========================================="
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm ci || npm install'
            }
        }

        stage('Deploy') {
            steps {
                sshagent([env.SSH_CREDS]) {
                    script {
                        def server = env.TARGET_SERVER
                        def path = env.DEPLOY_PATH
                        def isProd = (env.DEPLOY_ENV == 'production')

                        echo "Deploying festease_backend to ${env.DEPLOY_ENV} (${server}:${path})..."

                        // Ensure directory exists on target server
                        sh "ssh -o StrictHostKeyChecking=no ${server} 'mkdir -p ${path}'"

                        // Sync codebase, excluding node_modules, .env, logs, and keys
                        sh """
                            rsync -avz --delete \
                                --exclude='node_modules' \
                                --exclude='.env' \
                                --exclude='logs' \
                                --exclude='keys' \
                                --exclude='.git' \
                                -e 'ssh -o StrictHostKeyChecking=no' ./ ${server}:${path}/ || [ \$? -eq 24 ]
                        """

                        // Remote execution: install dependencies, run migrations, reload PM2 service
                        def installCmd = isProd ? "npm install --omit=dev" : "npm install"
                        sh """
                            ssh -o StrictHostKeyChecking=no ${server} 'cd ${path} && ${installCmd} && (npm run migrate || true) && (pm2 reload ${env.PM2_APP_NAME} --update-env || pm2 restart ${env.PM2_APP_NAME} --update-env || pm2 start ecosystem.config.cjs || pm2 start index.js --name ${env.PM2_APP_NAME})'
                        """
                    }
                }
            }
        }
    }

    post {
        success {
            echo "✅ Successfully deployed festease_backend to ${env.DEPLOY_ENV} (${env.TARGET_SERVER})"
        }
        failure {
            echo "❌ Pipeline failed for festease_backend on branch ${env.BRANCH_NAME ?: 'unknown'}"
        }
    }
}
