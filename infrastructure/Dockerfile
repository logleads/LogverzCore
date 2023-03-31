#FROM amazonlinux:2
FROM public.ecr.aws/amazonlinux/amazonlinux:2

RUN yum update -y
RUN yum install -y tar gzip awscli

#Adding Microsoft repo for MSSQL dependency and installing tools
RUN curl https://packages.microsoft.com/config/rhel/8/prod.repo > /etc/yum.repos.d/msprod.repo
RUN ACCEPT_EULA=Y yum install mssql-tools unixODBC-devel -y
RUN echo 'export PATH="$PATH:/opt/mssql-tools/bin"' >> ~/.bash_profile && echo 'export PATH="$PATH:/opt/mssql-tools/bin"' >> ~/.bashrc
#RUN source ~/.bashrc

ARG NODE_VERSION=$NODE_VERSION
RUN echo "The Node version: " $NODE_VERSION

#Installing nodejs on Amazon Linux #kudos: https://stackoverflow.com/questions/36399848/install-node-in-dockerfile
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
RUN export NVM_DIR="$HOME/.nvm"
ENV NVM_DIR=/root/.nvm
RUN . "$NVM_DIR/nvm.sh" && nvm install ${NODE_VERSION}
RUN . "$NVM_DIR/nvm.sh" && nvm use v${NODE_VERSION}
RUN . "$NVM_DIR/nvm.sh" && nvm alias default v${NODE_VERSION}
ENV PATH="/root/.nvm/versions/node/v${NODE_VERSION}/bin/:${PATH}"

RUN      npm install pm2 -g

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
RUN mkdir build
RUN mkdir mssqlqueryplanspath

COPY ./ ./


#RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

EXPOSE 80
CMD [ "pm2-runtime","proxyserver.js"]

#source: https://nodejs.org/de/docs/guides/nodejs-docker-webapp/
#build commands
#export NODE_VERSION
#NODE_VERSION="14.18.3"
#docker build -t logverz/webrtcproxy . --build-arg NODE_VERSION=$NODE_VERSION

#test command , host networking mode: 
#docker run --env AWS_REGION=ap-southeast-2 -d --network='host' logverz/webrtcproxy:latest 
# $(aws ecr get-login --no-include-email --region ap-southeast-2)
#docker tag logverz/webrtcproxy:latest accountnumber.dkr.ecr.ap-southeast-2.amazonaws.com/logverz/webrtcproxy:latest

# docker push accountnumber.dkr.ecr.ap-southeast-2.amazonaws.com/logverz/webrtcproxy:latest
#docker pull accountnumber.dkr.ecr.ap-southeast-2.amazonaws.com/logverz/webrtcproxy:latest
# docker tag accountnumber.dkr.ecr.ap-southeast-2.amazonaws.com/logverz/webrtcproxy:latest logverz/webrtcproxy:latest


#docker run --env AWS_REGION=ap-southeast-2 -d --mount type=bind,source=/etc/logverzenv,target=/usr/src/app/build --network='host' logverz/webrtcproxy:latest 