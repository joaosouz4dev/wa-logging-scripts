# WA Mobile Logging Scripts

> [!IMPORTANT]
> You will need to use an Emulator or a Rooted Device, and we'll use Frida for logging.  
> **Note:** I will not cover how to set up Frida. I recommend watching this [video](https://www.youtube.com/watch?v=RXw-4TymR5s) for guidance.

## Tools Needed

-   [Frida](https://github.com/frida/frida) to log WhatsApp.
-   Emulator or Rooted Device (this tutorial will use an Emulator).

## How to Log SENT/RECV Nodes

1. **Run the Script with Frida**  
   Execute the following command to run Frida and start logging:

    ```bash
    frida -U -f com.whatsapp -l path/to/script
    ```
