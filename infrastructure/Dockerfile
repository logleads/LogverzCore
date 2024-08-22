FROM  public.ecr.aws/ubuntu/ubuntu:22.04_stable
ENV DEBIAN_FRONTEND=noninteractive
ENV ACCEPT_EULA=Y

RUN apt update && apt upgrade -y && apt install curl -y

RUN curl -sSL -O https://packages.microsoft.com/config/ubuntu/22.04/packages-microsoft-prod.deb && \
    dpkg -i packages-microsoft-prod.deb && \
    rm packages-microsoft-prod.deb && \
    apt-get update
    
RUN apt-get install mssql-tools msodbcsql17 -y

RUN echo 'export PATH="$PATH:/opt/mssql-tools/bin"' >> ~/.bash_profile && echo 'export PATH="$PATH:/opt/mssql-tools/bin"' >> ~/.bashrc

ARG NODE_VERSION=$NODE_VERSION
RUN echo "The Node version: " $NODE_VERSION && \
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && \
    export NVM_DIR="$HOME/.nvm"

ENV NVM_DIR=/root/.nvm
RUN . "$NVM_DIR/nvm.sh" && nvm install ${NODE_VERSION} && \
    . "$NVM_DIR/nvm.sh" && nvm use v${NODE_VERSION} && \
    . "$NVM_DIR/nvm.sh" && nvm alias default v${NODE_VERSION}
   
ENV PATH="/root/.nvm/versions/node/v${NODE_VERSION}/bin/:${PATH}"
ENV sequalisepath="file:///usr/src/app/node_modules/sequelize/lib/index.mjs"

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
RUN npm install pm2 -g && \
    mkdir build && \
    mkdir build/debug && \
    mkdir mssqlqueryplanspath

COPY ./ ./


#RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

EXPOSE 80
CMD [ "pm2-runtime","proxyserver.js"]

#build commands
#export NODE_VERSION
#NODE_VERSION="18.20.2"
#docker build -t logverz/webrtcproxy . --build-arg NODE_VERSION=$NODE_VERSION

#test command , host networking mode: 
#docker run --env AWS_REGION=ap-southeast-2 -d --network='host' logverz/webrtcproxy:latest 
# docker exec -it CONTAINERID bash
# $(aws ecr get-login --no-include-email --region ap-southeast-2)
#docker tag logverz/webrtcproxy:latest accountnumber.dkr.ecr.ap-southeast-2.amazonaws.com/logverz/webrtcproxy:latest

# docker push accountnumber.dkr.ecr.ap-southeast-2.amazonaws.com/logverz/webrtcproxy:latest
#docker pull accountnumber.dkr.ecr.ap-southeast-2.amazonaws.com/logverz/webrtcproxy:latest
# docker tag accountnumber.dkr.ecr.ap-southeast-2.amazonaws.com/logverz/webrtcproxy:latest logverz/webrtcproxy:latest


#docker run --env AWS_REGION=ap-southeast-2 -d --mount type=bind,source=/etc/logverzenv,target=/usr/src/app/build --network='host' logverz/webrtcproxy:latest 
#docker run --env AWS_REGION=ap-southeast-2 --env sequalisepath=/usr/src/app/node_modules/sequelize/lib/index.mjs -d --network='host' --mount type=bind,source=/home/ec2-user/,target=/usr/src/app/build --log-driver=awslogs --log-opt awslogs-group=/Logverz/WebRTCProxy logverz/webrtcproxy:latest 
