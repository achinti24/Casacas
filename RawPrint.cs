using System;
using System.Runtime.InteropServices;
using System.IO;

class RawPrint {
    [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]
    static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);

    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)]
    struct DOC_INFO_1 {
        public string pDocName;
        public string pOutputFile;
        public string pDataType;
    }

    [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]
    static extern int StartDocPrinter(IntPtr h, int level, ref DOC_INFO_1 info);

    [DllImport("winspool.drv", SetLastError=true)]
    static extern bool StartPagePrinter(IntPtr h);

    [DllImport("winspool.drv", SetLastError=true)]
    static extern bool WritePrinter(IntPtr h, byte[] buf, int len, out int written);

    [DllImport("winspool.drv", SetLastError=true)]
    static extern bool EndPagePrinter(IntPtr h);

    [DllImport("winspool.drv", SetLastError=true)]
    static extern bool EndDocPrinter(IntPtr h);

    [DllImport("winspool.drv", SetLastError=true)]
    static extern bool ClosePrinter(IntPtr h);

    static int Main(string[] args) {
        if (args.Length < 2) {
            Console.Error.WriteLine("Uso: RawPrint.exe <NombreImpresora> <archivo.bin>");
            return 1;
        }
        string printer = args[0];
        string file    = args[1];

        if (!File.Exists(file)) {
            Console.Error.WriteLine("Archivo no encontrado: " + file);
            return 1;
        }

        byte[] data = File.ReadAllBytes(file);
        IntPtr handle = IntPtr.Zero;

        if (!OpenPrinter(printer, out handle, IntPtr.Zero)) {
            Console.Error.WriteLine("No se pudo abrir la impresora: " + printer);
            return 1;
        }

        var info = new DOC_INFO_1 {
            pDocName    = "Casacas",
            pOutputFile = null,
            pDataType   = "RAW"
        };

        StartDocPrinter(handle, 1, ref info);
        StartPagePrinter(handle);
        int written = 0;
        WritePrinter(handle, data, data.Length, out written);
        EndPagePrinter(handle);
        EndDocPrinter(handle);
        ClosePrinter(handle);
        return 0;
    }
}