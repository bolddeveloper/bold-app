import http.client
import os
import sys


def main():
    connection = http.client.HTTPConnection("127.0.0.1", 8000, timeout=3)
    try:
        connection.request(
            "GET",
            "/health/",
            headers={
                "Host": os.environ.get("HEALTHCHECK_HOST", "api.bold.gt"),
                "X-Forwarded-Proto": "https",
            },
        )
        response = connection.getresponse()
        response.read()
        return 0 if response.status == 200 else 1
    except OSError:
        return 1
    finally:
        connection.close()


if __name__ == "__main__":
    sys.exit(main())
