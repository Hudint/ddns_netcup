from ddns_netcup.app import create_app
from ddns_netcup.config import load_config


if __name__ == "__main__":
    config = load_config()
    app = create_app(config)
    app.run(host=config.bind_host, port=config.bind_port)
