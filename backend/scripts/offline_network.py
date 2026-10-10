"""Deny outbound test networking while retaining Windows asyncio's local self-pipe."""
import os
import socket


def install_network_guard():
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def denied(*args, **kwargs):
        raise RuntimeError("Outbound networking is denied in backend tests")

    def connect(sock, *args, **kwargs):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            return denied()
        return original_connect(sock, *args, **kwargs)

    def connect_ex(sock, *args, **kwargs):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            return denied()
        return original_connect_ex(sock, *args, **kwargs)

    if os.name == "nt":
        # Never temporarily unpatch connect: only this newly allocated socket
        # can reach this function's ephemeral loopback listener.
        def local_socketpair(family=None, type=socket.SOCK_STREAM, proto=0):
            if family not in (None, socket.AF_INET) or type != socket.SOCK_STREAM or proto != 0:
                raise ValueError("Unsupported offline socketpair")
            client = server = None
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
                listener.settimeout(2)
                listener.bind(("127.0.0.1", 0))
                listener.listen(1)
                try:
                    client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    client.settimeout(2)
                    original_connect(client, listener.getsockname())
                    server, peer = listener.accept()
                    if peer != client.getsockname():
                        raise RuntimeError("Unexpected offline self-pipe peer")
                    client.settimeout(None)
                    server.settimeout(None)
                    return server, client
                except BaseException:
                    if client is not None:
                        client.close()
                    if server is not None:
                        server.close()
                    raise
        socket.socketpair = local_socketpair

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.create_connection = denied
    socket.getaddrinfo = denied
    socket.socket.sendto = denied
