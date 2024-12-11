const express = require('express')
const Docker = require('dockerode')
const http = require('http');
const httpProxy = require('http-proxy')
const cors = require('cors')
const docker = new Docker()
const app = express()
const proxy = httpProxy.createProxyServer({})
const fs = require('fs')
const path = require('path')

app.use(express.json());

const allowedOrigins = ['https://www.automateandlearn.site', 'https://automateandlearn.site', 'http://localhost:*'];

app.use(cors({
    origin: allowedOrigins
}))

const server = http.createServer(app)

const PORT_TO_CONTAINER = {}
const CONTAINER_TO_PORT = {}
const usedPorts = new Set()

app.get('/', async (req, res) => {
    return res.json({ msg: "Response from docker manager" })
})

app.get('/containers', async (req, res) => {
    const containersList = await docker.listContainers()
    return res.json({ containersList })
})

app.post('/start-container', async (req, res) => {
    const { image } = req.body;
    const folder = req.headers.userid;
    console.log(`Folder: ${folder}`);
    

    const dir = path.join('/home', process.env.USER, `/temp/${folder}`)
    const containerDir = '/app/user'
    if(!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true })
        } catch (error) {
            console.log(error);
        }
    }

    await docker.pull(image, (err, stream) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        docker.modem.followProgress(stream, onFinished, onProgress);

        function onFinished(err, output) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            createAndStartContainer();
        }

        function onProgress(event) {
            console.log(event);
        }

        async function createAndStartContainer() {
            const availablePort = await getAvailablePorts();
            const container = await docker.createContainer({
                Image: image,
                ExposedPorts: {
                    '9000/tcp': {},
                },
                HostConfig: {
                    PortBindings: {
                        '9000/tcp': [{ HostPort: availablePort.toString() }],
                    },
                    Binds: [`${dir}:${containerDir}`]
                }
            });
            PORT_TO_CONTAINER[availablePort] = container.id;
            CONTAINER_TO_PORT[container.id] = availablePort;
            console.log(CONTAINER_TO_PORT);
            console.log(PORT_TO_CONTAINER);
            await container.start();
            return res.json({ container: container.id, port: availablePort });
        }
    });
});

app.post('/req-to-container', (req, res) => {
    const { port } = req.headers
    console.log('port number in header:', port);
    const targetUrl = `http://localhost:${port}`

    return proxy.web(req, res, { target: targetUrl, changeOrigin: true })
})

app.use((req, res) => {
    const { port } = req.headers

    const corsHeaders = {
        'Access-Control-Allow-Origin': req.headers.origin || '*',
    };

    const resolvesToUrl = `http://localhost:${port}`

    return proxy.web(req, res, { target: resolvesToUrl, changeOrigin: true, headers: corsHeaders })
})


server.on('upgrade', (req, socket, head) => {
    const { port } = req.headers
    console.log('port number in header:', port);
    const targetUrl = `http://localhost:${port}`
    console.log(`Upgrade event called and the target url is: ${targetUrl}`);
    const corsHeaders = {
        'Access-Control-Allow-Origin': req.headers.origin || '*',
    };
    try {
        proxy.ws(req, socket, head, { target: targetUrl, changeOrigin: true, headers: corsHeaders }, (err) => {
            if (err) {
                console.error('Proxy WebSocket error:', err);
            }
        });
    } catch (error) {
        console.log(error);
    }
})


async function isPortAvailable(port) {
    return new Promise((resolve, reject) => {
        const server = http.createServer();

        server.once('error', (err) => {
            console.log(`Error event: ${err.code}`);
            if (err.code === 'EADDRINUSE') {
                resolve(false);
            } else {
                reject(err);
            }
        });

        server.once('listening', () => {
            console.log(`Listening event on port ${port}`);
            server.close(() => {
                resolve(true);
            });
        });

        server.listen(port, '127.0.0.1', () => {
            console.log(`Trying to listen on port ${port}`);
        });
    });
}

async function getAvailablePorts() {
    for (let port = 8000; port <= 65535; port++) {
        if (await isPortAvailable(port)) {
            usedPorts.add(port);
            return `${port}`;
        }
    }
    throw new Error('No available ports');
}

server.listen(8080, () => console.log('Docker manager running on port 8080'))
